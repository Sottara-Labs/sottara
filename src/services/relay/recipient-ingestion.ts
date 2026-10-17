/*
 * Recipient Queue Ingestion Service (BETA-034).
 *
 * Drives inbound mail ingestion from the relay queue into the recipient's mailbox:
 * - Processes inbound envelopes through the hardened recipient pipeline (BETA-047)
 * - Quarantines invalid, corrupted, or unverified envelopes without leaking secrets
 * - Enforces exactly-once delivery and deduplication across concurrent workers
 * - Emits durable sync events to the mailbox repository
 */

import type { StoredEnvelope } from "@/server/api/domain";
import type { ApiRepository } from "@/server/api/repository";
import type { KeyProvider } from "@/services/crypto/open-envelope";
import { processInboundEnvelope } from "@/features/mail/recipient-pipeline";
import type { RelayEnvelope, RelayPersistence } from "./persistence";

/** Default number of envelopes processed per invocation. */
export const DEFAULT_INGEST_BATCH = 50;

/** Hard upper bound on envelopes processed per invocation. */
export const MAX_INGEST_BATCH = 200;

export interface RecipientIngestionOptions {
  persistence: RelayPersistence;
  repository: Pick<ApiRepository, "insertEnvelope" | "getEnvelope" | "listRecipientEnvelopes">;
  keys?: KeyProvider;
  now?: () => Date;
  requireSenderSignature?: boolean;
}

export interface IngestionResult {
  messageId: string;
  recipient: string;
  status: "delivered" | "quarantined" | "duplicate" | "skipped";
  diagnosticId?: string;
}

export interface IngestQueueOptions {
  /** Maximum number of envelopes to process in this invocation. */
  limit?: number;
  /** Opaque cursor returned by a previous invocation. */
  cursor?: string;
}

export interface IngestQueueResult {
  results: IngestionResult[];
  /** Cursor to resume from, or undefined when the queue is drained. */
  nextCursor?: string;
  /** Number of envelopes processed in this invocation. */
  processed: number;
  /** True when the queue has more envelopes beyond this batch. */
  hasMore: boolean;
}

interface QueueCursor {
  receivedAt: string;
  messageId: string;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_INGEST_BATCH;
  const truncated = Math.trunc(limit);
  if (truncated < 1) return 1;
  if (truncated > MAX_INGEST_BATCH) return MAX_INGEST_BATCH;
  return truncated;
}

function encodeCursor(cursor: QueueCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(raw: string): QueueCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid queue cursor");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as QueueCursor).receivedAt !== "string" ||
    typeof (parsed as QueueCursor).messageId !== "string"
  ) {
    throw new Error("Invalid queue cursor");
  }
  return parsed as QueueCursor;
}

/**
 * Total ordering for the queue: receivedAt ascending, tien broken by messageId.
 * This matches the contract in docs/api/PAGINATION.md.
 */
function compareQueueEntry(a: RelayEnvelope, b: RelayEnvelope): number {
  const ar = a.receivedAt || "";
  const br = b.receivedAt || "";
  if (ar < br) return -1;
  if (ar > br) return 1;
  if (a.messageId < b.messageId) return -1;
  if (a.messageId > b.messageId) return 1;
  return 0;
}

function isAfterCursor(entry: RelayEnvelope, cursor: QueueCursor): boolean {
  const receivedAt = entry.receivedAt || "";
  if (receivedAt > cursor.receivedAt) return true;
  if (receivedAt < cursor.receivedAt) return false;
  return entry.messageId > cursor.messageId;
}

export class RecipientIngestionService {
  private static readonly globalClaims = new Set<string>();
  private readonly persistence: RelayPersistence;
  private readonly repository: Pick<
    ApiRepository,
    "insertEnvelope" | "getEnvelope" | "listRecipientEnvelopes"
  >;
  private readonly keys?: KeyProvider;
  private readonly now: () => Date;
  private readonly requireSenderSignature: boolean;

  constructor(options: RecipientIngestionOptions) {
    this.persistence = options.persistence;
    this.repository = options.repository;
    this.keys = options.keys;
    this.now = options.now ?? (() => new Date());
    this.requireSenderSignature = options.requireSenderSignature ?? false;
  }

  /**
   * Atomically claims a messageId for ingestion to protect concurrent workers.
   */
  claim(messageId: string): boolean {
    if (RecipientIngestionService.globalClaims.has(messageId)) return false;
    RecipientIngestionService.globalClaims.add(messageId);
    return true;
  }

  /**
   * Release in-flight claim.
   */
  release(messageId: string): void {
    RecipientIngestionService.globalClaims.delete(messageId);
  }

  /**
   * Ingest a single relay envelope into the recipient mailbox exactly once.
   */
  async ingestEnvelope(envelope: RelayEnvelope): Promise<IngestionResult> {
    if (!this.claim(envelope.messageId)) {
      return {
        messageId: envelope.messageId,
        recipient: envelope.recipient,
        status: "skipped",
      };
    }

    try {
      // 1. Idempotency check: check if already exists in recipient repository
      const existing = await this.repository.getEnvelope(envelope.messageId);
      if (existing) {
        return {
          messageId: envelope.messageId,
          recipient: envelope.recipient,
          status: "duplicate",
        };
      }

      const receivedAt = envelope.receivedAt || this.now().toISOString();

      // 2. Validate envelope through cryptographic inbound pipeline if keys provided
      if (this.keys) {
        let payloadParsed: unknown = envelope.payload;
        try {
          payloadParsed = JSON.parse(envelope.payload);
        } catch {
          // If not JSON, pass as-is
        }

        const processResult = await processInboundEnvelope({
          input: {
            payload: payloadParsed,
            ciphertext: envelope.payload,
          },
          keys: this.keys,
          expectedRecipient: envelope.recipient,
          expectedSender: envelope.sender,
          requireSenderSignature: this.requireSenderSignature,
        });

        if (processResult.status === "quarantined") {
          // Quarantine invalid envelope: isolate without exposing raw content
          const storedQuarantine: StoredEnvelope = {
            messageId: envelope.messageId,
            senderId: envelope.sender,
            recipientId: envelope.recipient,
            ciphertext: "",
            protectedHeaders: {},
            createdAt: receivedAt,
            status: "quarantined",
            metadata: {
              quarantined: true,
              quarantineRecord: processResult.quarantineRecord,
            },
          };

          await this.repository.insertEnvelope(storedQuarantine);

          return {
            messageId: envelope.messageId,
            recipient: envelope.recipient,
            status: "quarantined",
            diagnosticId: processResult.quarantineRecord.diagnosticId,
          };
        }
      }

      // 3. Valid envelope: append to mailbox repository
      const storedEnvelope: StoredEnvelope = {
        messageId: envelope.messageId,
        senderId: envelope.sender,
        recipientId: envelope.recipient,
        ciphertext: envelope.payload,
        protectedHeaders: {},
        createdAt: receivedAt,
        status: "pending",
        metadata: {
          admission: envelope.admission,
          storageKey: envelope.payloadStorageKey,
        },
      };

      await this.repository.insertEnvelope(storedEnvelope);

      return {
        messageId: envelope.messageId,
        recipient: envelope.recipient,
        status: "delivered",
      };
    } finally {
      this.release(envelope.messageId);
    }
  }

  /**
   * Drain and ingest a stable, bounded batch of queued envelopes for a specific recipient.
   *
   * The queue is ordered by (receivedAt, messageId) -- a total order -- and the
   * cursor names the exact position of the last processed envelope. A caller
   * resumes by passing the returned `nextCursor` until `hasMore` is false.
   */
  async ingestRecipentQueeu(
    recipient: string,
    options: IngestQueueOptions = {},
  ): Promise<IngestQueueResult> {
    const limit = clampLimit(options.limit);
    const cursor = options.cursor ? decodeCursor(options.cursor) : undefined;

    const queue = await this.persistence.listRecipientQueue(recipient);
    const ordered = [...queue].sort(compareQueueEntry);

    // Resume strictly after the cursor position in the total order.
    const remaining = cursor ? ordered.filter((e) => isAfterCursor(e, cursor)) : ordered;

    const batch = remaining.slice(0, limit);
    const hasMore = remaining.length > batch.length;

    const results: IngestionResult[] = [];
    for (const envelope of batch) {
      const result = await this.ingestEnvelope(envelope);
      results.push(result);
    }

    let nextCursor: string | undefined;
    if (hasMore && batch.length > 0) {
      const last = batch[batch.length - 1];
      nextCursor = encodeCursor({
        receivedAt: last.receivedAt || "",
        messageId: last.messageId,
      });
    }

    return {
      results,
      nextCursor,
      processed: batch.length,
      hasMore,
    };
  }
}
