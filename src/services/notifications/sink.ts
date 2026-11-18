import type { DeliveryReceipt, NotificationAdapter, VerificationEmailMessage } from "./adapter";

interface BufferedMessage extends VerificationEmailMessage {
  capturedAt: Date;
}

/**
 * BETA-005: Local-development capture sink.
 *
 * Captures verification messages in memory instead of sending them over the
 * network. This is the default transport for development/preview profiles and
 * MUST NOT be selected in the production path — the production transport
 * defaults to SMTP and the adapter factory refuses to construct a sink in
 * production.
 *
 * The captured messages are visible to tests and local tooling only; the
 * buffer is never persisted and is cleared on `clear()`.
 */
export class SinkNotificationAdapter implements NotificationAdapter {
  readonly transport = "sink" as const;

  private readonly messages: BufferedMessage[] = [];

  constructor(
    private readonly maxBuffered: number = 1000,
    private readonly maxRetentionMs: number = 24 * 60 * 60 * 1000,
  ) {}

  private pruneExpired(now: Date = new Date()): void {
    const nowMs = now.getTime();
    let writeIdx = 0;
    for (let i = 0; i < this.messages.length; i++) {
      const item = this.messages[i];
      const itemExpiresMs =
        item.expiresAt instanceof Date
          ? item.expiresAt.getTime()
          : new Date(item.expiresAt).getTime();
      const itemCapturedMs = item.capturedAt ? item.capturedAt.getTime() : itemExpiresMs;
      const isExpired =
        nowMs >= itemExpiresMs ||
        (this.maxRetentionMs > 0 && nowMs - itemCapturedMs >= this.maxRetentionMs);
      if (!isExpired) {
        this.messages[writeIdx++] = item;
      }
    }
    this.messages.length = writeIdx;
  }

  async deliverVerificationEmail(message: VerificationEmailMessage): Promise<DeliveryReceipt> {
    const now = new Date();
    this.pruneExpired(now);

    const expiresAt = new Date(message.expiresAt);
    const nowMs = now.getTime();
    const isExpired = nowMs >= expiresAt.getTime();

    if (!isExpired) {
      if (this.messages.length >= this.maxBuffered) {
        this.messages.shift();
      }
      this.messages.push({
        ...message,
        expiresAt,
        capturedAt: now,
      });
    }

    const providerRef =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? `sink-${crypto.randomUUID()}`
        : `sink-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    return {
      transport: "sink",
      accepted: true,
      providerRef,
      safeTargetReference: await sha256Reference(message.to),
    };
  }

  /** Messages captured so far, oldest first. Never persisted. Expired messages are pruned. */
  get capturedMessages(): readonly VerificationEmailMessage[] {
    this.pruneExpired();
    return this.messages.map((message) => ({
      to: message.to,
      purpose: message.purpose,
      verificationUrl: message.verificationUrl,
      expiresAt: new Date(message.expiresAt),
    }));
  }

  /** Most recently captured message, if any. Expired messages are pruned. */
  get latestMessage(): VerificationEmailMessage | null {
    this.pruneExpired();
    const latest = this.messages.at(-1);
    return latest
      ? {
          to: latest.to,
          purpose: latest.purpose,
          verificationUrl: latest.verificationUrl,
          expiresAt: new Date(latest.expiresAt),
        }
      : null;
  }

  get size(): number {
    this.pruneExpired();
    return this.messages.length;
  }

  clear(): void {
    this.messages.length = 0;
  }
}

async function sha256Reference(value: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    return `ref:${value}`;
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}
