import type { DeliveryReceipt, VerificationEmailMessage } from "./adapter";

/**
 * BETA-005 / BETA-091: Cryptographically-verifiable notification delivery audit trail.
 *
 * Implements tamper-evident audit logging for notification events with HMAC-SHA256
 * chain hashes, non-secret metadata correlation, delivery latency profiling, and
 * transport anomaly detection.
 *
 * Security Invariants:
 * - Plaintext tokens are NEVER stored, logged, or included in audit metadata.
 * - All audit entries use non-reversible target references (e.g. SHA-256 email digests).
 * - Every audit record is sequentially linked via cryptographic HMAC-SHA256 chaining.
 * - Unkeyed hashes detect only accidental corruption; keyed HMAC guarantees tamper-evidence.
 */

export interface NotificationAuditKeyConfig {
  readonly keyId: string;
  readonly secret: string;
}

export const DEFAULT_AUDIT_KEY_CONFIG: NotificationAuditKeyConfig = {
  keyId: "audit-key-v1",
  secret: "stealth-notification-audit-secret-v1",
};

export interface DeliveryAuditEvent {
  readonly sequenceId: number;
  readonly eventType:
    | "delivery.dispatched"
    | "delivery.succeeded"
    | "delivery.failed"
    | "delivery.retried"
    | "delivery.circuit_opened"
    | "delivery.rate_limited";
  readonly transport: string;
  readonly safeTargetReference: string;
  readonly providerRef?: string;
  readonly messageId?: string;
  readonly durationMs: number;
  readonly timestamp: string;
  readonly previousHash: string;
  readonly recordHash: string;
  readonly keyId: string;
  readonly metadata?: Record<string, string | number | boolean>;
}

export interface AuditTrailSummary {
  readonly totalEvents: number;
  readonly successfulDeliveries: number;
  readonly failedDeliveries: number;
  readonly averageLatencyMs: number;
  readonly lastAuditHash: string;
  readonly transportBreakdown: Record<string, number>;
  readonly verifiedChainIntegrity: boolean;
}

export class NotificationAuditTrail {
  private readonly events: DeliveryAuditEvent[] = [];
  private currentSequence = 0;
  private lastHash = "GENESIS_AUDIT_BLOCK_00000000000000000000000000000000";
  private readonly auditKeyConfig: NotificationAuditKeyConfig;

  constructor(
    private readonly maxBufferSize = 5000,
    auditKeyConfig?: Partial<NotificationAuditKeyConfig> | NotificationAuditKeyConfig,
  ) {
    this.auditKeyConfig = {
      keyId: auditKeyConfig?.keyId ?? DEFAULT_AUDIT_KEY_CONFIG.keyId,
      secret: auditKeyConfig?.secret ?? DEFAULT_AUDIT_KEY_CONFIG.secret,
    };
  }

  get keyId(): string {
    return this.auditKeyConfig.keyId;
  }

  /**
   * Records a notification dispatch attempt or completion with cryptographic chaining.
   */
  async recordEvent(params: {
    eventType: DeliveryAuditEvent["eventType"];
    transport: string;
    safeTargetReference: string;
    providerRef?: string;
    messageId?: string;
    durationMs: number;
    metadata?: Record<string, string | number | boolean>;
  }): Promise<DeliveryAuditEvent> {
    this.currentSequence++;
    const timestamp = new Date().toISOString();
    const prevHash = this.lastHash;

    const payloadToHash = JSON.stringify({
      sequence: this.currentSequence,
      eventType: params.eventType,
      transport: params.transport,
      target: params.safeTargetReference,
      ref: params.providerRef ?? "",
      msgId: params.messageId ?? "",
      duration: params.durationMs,
      ts: timestamp,
      prev: prevHash,
      keyId: this.auditKeyConfig.keyId,
      meta: params.metadata ?? {},
    });

    const recordHash = await computeHmacSha256(this.auditKeyConfig.secret, payloadToHash);
    this.lastHash = recordHash;

    const event: DeliveryAuditEvent = {
      sequenceId: this.currentSequence,
      eventType: params.eventType,
      transport: params.transport,
      safeTargetReference: params.safeTargetReference,
      providerRef: params.providerRef,
      messageId: params.messageId,
      durationMs: Math.max(0, Math.round(params.durationMs)),
      timestamp,
      previousHash: prevHash,
      recordHash,
      keyId: this.auditKeyConfig.keyId,
      metadata: params.metadata,
    };

    if (this.events.length >= this.maxBufferSize) {
      this.events.shift();
    }
    this.events.push(event);

    return event;
  }

  /**
   * Validates the cryptographic integrity of the audit chain from start to end using HMAC-SHA256.
   * If a verifyKey is provided, it validates against that key; otherwise uses this instance's audit key.
   */
  async verifyChainIntegrity(verifyKey?: NotificationAuditKeyConfig): Promise<boolean> {
    if (this.events.length === 0) return true;

    const keyToUse = verifyKey ?? this.auditKeyConfig;

    for (let i = 0; i < this.events.length; i++) {
      const event = this.events[i];
      const prevHash = i === 0 ? event.previousHash : this.events[i - 1].recordHash;

      if (event.previousHash !== prevHash) {
        return false;
      }

      if (event.keyId !== keyToUse.keyId) {
        return false;
      }

      const payloadToHash = JSON.stringify({
        sequence: event.sequenceId,
        eventType: event.eventType,
        transport: event.transport,
        target: event.safeTargetReference,
        ref: event.providerRef ?? "",
        msgId: event.messageId ?? "",
        duration: event.durationMs,
        ts: event.timestamp,
        prev: event.previousHash,
        keyId: event.keyId,
        meta: event.metadata ?? {},
      });

      const isValid = await verifyHmacSha256(keyToUse.secret, payloadToHash, event.recordHash);
      if (!isValid) {
        return false;
      }
    }

    return true;
  }

  /**
   * Returns a statistical summary of the delivery audit log.
   */
  async getSummary(): Promise<AuditTrailSummary> {
    let successCount = 0;
    let failCount = 0;
    let totalLatency = 0;
    const transportMap: Record<string, number> = {};

    for (const evt of this.events) {
      if (evt.eventType === "delivery.succeeded") successCount++;
      if (evt.eventType === "delivery.failed") failCount++;
      totalLatency += evt.durationMs;
      transportMap[evt.transport] = (transportMap[evt.transport] ?? 0) + 1;
    }

    const isChainValid = await this.verifyChainIntegrity();

    return {
      totalEvents: this.events.length,
      successfulDeliveries: successCount,
      failedDeliveries: failCount,
      averageLatencyMs: this.events.length > 0 ? Math.round(totalLatency / this.events.length) : 0,
      lastAuditHash: this.lastHash,
      transportBreakdown: transportMap,
      verifiedChainIntegrity: isChainValid,
    };
  }

  /**
   * Retrieves events filtered by target reference or event type.
   */
  findEventsByTarget(safeTargetReference: string): DeliveryAuditEvent[] {
    return this.events.filter((e) => e.safeTargetReference === safeTargetReference);
  }

  /**
   * Clears the in-memory audit trail (useful for test resets).
   */
  clear(): void {
    this.events.length = 0;
    this.currentSequence = 0;
    this.lastHash = "GENESIS_AUDIT_BLOCK_00000000000000000000000000000000";
  }

  get allEvents(): readonly DeliveryAuditEvent[] {
    return [...this.events];
  }
}

/**
 * Computes an HMAC-SHA256 hex string over canonical input using Web Crypto API.
 */
export async function computeHmacSha256(secret: string, input: string): Promise<string> {
  const enc = new TextEncoder();
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", key, enc.encode(input));
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  const { createHmac } = await import("node:crypto");
  return createHmac("sha256", secret).update(input).digest("hex");
}

/**
 * Verifies an HMAC-SHA256 signature using crypto.subtle.verify.
 */
export async function verifyHmacSha256(
  secret: string,
  input: string,
  hexSignature: string,
): Promise<boolean> {
  const enc = new TextEncoder();
  if (typeof crypto !== "undefined" && crypto.subtle) {
    try {
      const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
      );
      if (hexSignature.length % 2 !== 0) return false;
      const sigBytes = new Uint8Array(hexSignature.length / 2);
      for (let i = 0; i < hexSignature.length; i += 2) {
        sigBytes[i / 2] = parseInt(hexSignature.slice(i, i + 2), 16);
      }
      return await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(input));
    } catch {
      return false;
    }
  }

  const { createHmac, timingSafeEqual } = await import("node:crypto");
  try {
    const expected = createHmac("sha256", secret).update(input).digest();
    const actual = Buffer.from(hexSignature, "hex");
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export const globalNotificationAuditTrail = new NotificationAuditTrail();
