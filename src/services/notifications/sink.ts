import type { DeliveryReceipt, NotificationAdapter, VerificationEmailMessage } from "./adapter";

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
interface StoredMessage extends VerificationEmailMessage {
  capturedAt: number;
}

export class SinkNotificationAdapter implements NotificationAdapter {
  readonly transport = "sink" as const;

  private readonly messages: StoredMessage[] = [];

  constructor(
    private readonly maxBuffered: number = 1000,
    private readonly maxRetentionMs: number = 24 * 60 * 60 * 1000,
  ) {}

  private pruneExpired(now: number = Date.now()): void {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const entry = this.messages[i];
      const expiryMs = new Date(entry.expiresAt).getTime();
      if (expiryMs <= now || now - entry.capturedAt >= this.maxRetentionMs) {
        this.messages.splice(i, 1);
      }
    }
  }

  async deliverVerificationEmail(message: VerificationEmailMessage): Promise<DeliveryReceipt> {
    const now = Date.now();
    this.pruneExpired(now);

    const providerRef =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `sink-${now}-${Math.random().toString(36).slice(2, 10)}`;

    const expiresAt = new Date(message.expiresAt);
    if (expiresAt.getTime() > now) {
      if (this.messages.length >= this.maxBuffered) {
        this.messages.shift();
      }
      this.messages.push({
        ...message,
        expiresAt,
        capturedAt: now,
      });
    }

    return {
      transport: "sink",
      accepted: true,
      providerRef,
      safeTargetReference: await sha256Reference(message.to),
    };
  }

  /** Messages captured so far, oldest first. Never persisted. */
  get capturedMessages(): readonly VerificationEmailMessage[] {
    this.pruneExpired();
    return this.messages.map(({ capturedAt: _capturedAt, ...message }) => ({
      ...message,
      expiresAt: new Date(message.expiresAt),
    }));
  }

  /** Most recently captured message, if any. */
  get latestMessage(): VerificationEmailMessage | null {
    this.pruneExpired();
    const latest = this.messages.at(-1);
    if (!latest) return null;
    const { capturedAt: _capturedAt, ...message } = latest;
    return { ...message, expiresAt: new Date(message.expiresAt) };
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
