/**
 * Relay Federation State Machine & Delivery Logic
 *
 * State Machine Documentation:
 *
 * 1. DISCOVERY: Resolve the target relay's URI and public key via Stellar/DNS federation.
 *    -> Transition to HANDOFF on success.
 *    -> Transition to DEAD_LETTER on permanent failure (e.g., domain not found).
 *    -> Transition to DISCOVERY (Retry) on transient failure.
 *
 * 2. HANDOFF: Authenticate and transmit the message to the peer relay.
 *    -> Transition to ACKNOWLEDGED on 2xx response.
 *    -> Transition to DEDUPLICATED if the peer indicates the message ID already exists.
 *    -> Transition to DEAD_LETTER on 4xx permanent failure (e.g., unauthorized, payload too large).
 *    -> Transition to HANDOFF (Retry) on 5xx or network errors, subject to backoff and expiry.
 *
 * 3. ACKNOWLEDGED: Delivery successful. Terminal state.
 *
 * 4. DEDUPLICATED: Cross-relay duplicate collapsed. Terminal state.
 *
 * 5. DEAD_LETTER: Permanent failure or expired retries. Emits actionable error code. Terminal state.
 */

import type { MessageDeliveryState } from "@/server/api/domain";

export type DeliveryState =
  | "DISCOVERY"
  | "HANDOFF"
  | "ACKNOWLEDGED"
  | "DEDUPLICATED"
  | "DEAD_LETTER";

export function mapRelayStateToMessageDeliveryState(
  relayState: DeliveryState,
  errorCode?: ActionableErrorCode,
): MessageDeliveryState {
  switch (relayState) {
    case "DISCOVERY":
      return "queued";
    case "HANDOFF":
      return "accepted";
    case "ACKNOWLEDGED":
    case "DEDUPLICATED":
      return "accepted";
    case "DEAD_LETTER":
      return errorCode === "ERR_DELIVERY_EXPIRED" ? "expired" : "failed";
    default:
      return "failed";
  }
}

export interface FederationMessage {
  id: string;
  recipientDomain: string;
  payload: string;
  expiryTimestamp: number;
}

export interface RelayNode {
  domain: string;
  endpoint: string;
  publicKey: string;
}

export interface FederationResolver {
  resolveRelay(domain: string): Promise<Pick<RelayNode, "endpoint" | "publicKey"> | null>;
}

export type ActionableErrorCode =
  | "ERR_DOMAIN_NOT_FOUND"
  | "ERR_UNAUTHORIZED"
  | "ERR_PAYLOAD_REJECTED"
  | "ERR_DELIVERY_EXPIRED"
  | "ERR_DELIVERY_RETRIES_EXHAUSTED"
  | "ERR_UNKNOWN_PERMANENT";

export interface DeliveryResult {
  state: DeliveryState;
  attempts: number;
  errorCode?: ActionableErrorCode;
}

export class FederationDeliveryService {
  private readonly MAX_RETRIES = 5;
  private readonly BASE_BACKOFF_MS = 1000;

  /**
   * Recent-message dedupe window for this worker.
   * A bounded FIFO keeps memory usage predictable; the oldest id is evicted
   * first when the window is full. Durable cross-worker dedupe belongs in the
   * backing Redis/DB store described by the service contract.
   */
  private static readonly MAX_DEDUPE_IDS = 10_000;
  private seenMessageIds: Set<string> = new Set();
  // Simulated dead-letter queue
  public deadLetterQueue: Array<{
    message: FederationMessage;
    code: ActionableErrorCode;
  }> = [];

  constructor(
    private resolveRelay: (domain: string) => Promise<RelayNode | null>,
    private transmitMessage: (
      node: RelayNode,
      message: FederationMessage,
    ) => Promise<{ status: number }>,
  ) {}

  private rememberMessageId(messageId: string): void {
    if (this.seenMessageIds.has(messageId)) return;

    if (this.seenMessageIds.size >= FederationDeliveryService.MAX_DEDUPE_IDS) {
      const oldest = this.seenMessageIds.values().next().value;
      if (oldest !== undefined) this.seenMessageIds.delete(oldest);
    }

    this.seenMessageIds.add(messageId);
  }

  /**
   * Main delivery loop implementing the state machine and retries.
   */
  public async deliver(message: FederationMessage): Promise<DeliveryResult> {
    if (this.seenMessageIds.has(message.id)) {
      return { state: "DEDUPLICATED", attempts: 0 };
    }

    let state: DeliveryState = "DISCOVERY";
    let attempts = 0;
    let relayNode: RelayNode | null = null;

    while (state !== "ACKNOWLEDGED" && state !== "DEAD_LETTER" && state !== "DEDUPLICATED") {
      if (Date.now() > message.expiryTimestamp) {
        this.moveToDeadLetter(message, "ERR_DELIVERY_EXPIRED");
        return {
          state: "DEAD_LETTER",
          attempts,
          errorCode: "ERR_DELIVERY_EXPIRED",
        };
      }

      try {
        if (state === "DISCOVERY") {
          relayNode = await this.resolveRelay(message.recipientDomain);
          if (!relayNode) {
            this.moveToDeadLetter(message, "ERR_DOMAIN_NOT_FOUND");
            state = "DEAD_LETTER";
            break;
          }
          state = "HANDOFF";
        }

        if (state === "HANDOFF" && relayNode) {
          attempts++;
          const response = await this.transmitMessage(relayNode, message);

          if (response.status >= 200 && response.status < 300) {
            state = "ACKNOWLEDGED";
            this.rememberMessageId(message.id);
          } else if (response.status === 409) {
            // Conflict implies already exists -> deduplication
            state = "DEDUPLICATED";
            this.rememberMessageId(message.id);
          } else if (response.status >= 400 && response.status < 500) {
            const code =
              response.status === 401 || response.status === 403
                ? "ERR_UNAUTHORIZED"
                : "ERR_PAYLOAD_REJECTED";
            this.moveToDeadLetter(message, code);
            state = "DEAD_LETTER";
          } else {
            // Transient 5xx error, throw to trigger retry logic
            throw new Error(`Transient error: HTTP ${response.status}`);
          }
        }
      } catch (error) {
        if (attempts >= this.MAX_RETRIES) {
          this.moveToDeadLetter(message, "ERR_DELIVERY_RETRIES_EXHAUSTED");
          state = "DEAD_LETTER";
        } else {
          // Bounded and jittered backoff
          await this.delay(this.calculateBackoff(attempts));
        }
      }
    }

    const result: DeliveryResult = { state, attempts };
    if (state === "DEAD_LETTER") {
      const dlqEntry = this.deadLetterQueue.find((e) => e.message.id === message.id);
      result.errorCode = dlqEntry?.code || "ERR_UNKNOWN_PERMANENT";
    }
    return result;
  }

  private calculateBackoff(attempt: number): number {
    const exponential = this.BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 500; // up to 500ms of jitter
    return exponential + jitter;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private moveToDeadLetter(message: FederationMessage, code: ActionableErrorCode) {
    this.deadLetterQueue.push({ message, code });
  }

  public inspectDeadLetters() {
    return this.deadLetterQueue;
  }
}

/**
 * Resolves a relay node endpoint and public key using the production federation resolver.
 */
export async function resolveRelayNodeViaFederation(
  domain: string,
  resolver?: FederationResolver,
): Promise<RelayNode | null> {
  if (!resolver) return null;

  try {
    const targetDomain = domain.toLowerCase().trim();
    if (!targetDomain) return null;

    const record = await resolver.resolveRelay(targetDomain);
    if (!record?.endpoint || !record.publicKey) return null;

    return {
      domain: targetDomain,
      endpoint: record.endpoint,
      publicKey: record.publicKey,
    };
  } catch {
    return null;
  }
}
