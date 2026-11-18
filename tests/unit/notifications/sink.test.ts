import { describe, expect, it, vi } from "vitest";

import type { VerificationEmailMessage } from "../../../src/services/notifications/adapter";
import { SinkNotificationAdapter } from "../../../src/services/notifications/sink";

function sampleMessage(
  overrides: Partial<VerificationEmailMessage> = {},
): VerificationEmailMessage {
  return {
    to: "alice@stealth.mail",
    purpose: "email_verification",
    verificationUrl: "https://stealth.mail/verify?email=alice%40stealth.mail&token=abc",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

describe("BETA-005: SinkNotificationAdapter (development capture sink)", () => {
  it("accepts every message and records a receipt", async () => {
    const sink = new SinkNotificationAdapter();
    const receipt = await sink.deliverVerificationEmail(sampleMessage());

    expect(receipt).toMatchObject({ transport: "sink", accepted: true });
    expect(receipt.safeTargetReference).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.providerRef).toMatch(/^sink-[0-9a-f-]+$/i);
  });

  it("buffers captured messages in delivery order", async () => {
    const sink = new SinkNotificationAdapter();
    await sink.deliverVerificationEmail(sampleMessage({ to: "first@stealth.mail" }));
    await sink.deliverVerificationEmail(sampleMessage({ to: "second@stealth.mail" }));

    expect(sink.size).toBe(2);
    expect(sink.capturedMessages.map((message) => message.to)).toEqual([
      "first@stealth.mail",
      "second@stealth.mail",
    ]);
    expect(sink.latestMessage?.to).toBe("second@stealth.mail");
  });

  it("preserves expiry as a Date in captured messages", async () => {
    const sink = new SinkNotificationAdapter();
    const expiresAt = new Date(Date.now() + 3600_000);
    await sink.deliverVerificationEmail(sampleMessage({ expiresAt }));

    expect(sink.latestMessage?.expiresAt).toBeInstanceOf(Date);
    expect(sink.latestMessage?.expiresAt).toEqual(expiresAt);
  });

  it("is bounded by the configured buffer size", async () => {
    const sink = new SinkNotificationAdapter(2);
    await sink.deliverVerificationEmail(sampleMessage({ to: "a@stealth.mail" }));
    await sink.deliverVerificationEmail(sampleMessage({ to: "b@stealth.mail" }));
    await sink.deliverVerificationEmail(sampleMessage({ to: "c@stealth.mail" }));

    expect(sink.size).toBe(2);
    expect(sink.capturedMessages.map((message) => message.to)).toEqual([
      "b@stealth.mail",
      "c@stealth.mail",
    ]);
  });

  it("isolates returned messages from caller mutation", async () => {
    const sink = new SinkNotificationAdapter();
    await sink.deliverVerificationEmail(sampleMessage());

    const captured = sink.latestMessage!;
    captured.to = "mutated@stealth.mail";
    expect(sink.latestMessage?.to).toBe("alice@stealth.mail");
  });

  it("clears the buffer on request", async () => {
    const sink = new SinkNotificationAdapter();
    await sink.deliverVerificationEmail(sampleMessage());
    expect(sink.size).toBe(1);

    sink.clear();
    expect(sink.size).toBe(0);
    expect(sink.latestMessage).toBeNull();
  });

  describe("BETA-083 / Issue #526: Expiry dropping and UUID provider refs", () => {
    it("an expired capture is no longer returned (dropped on write or pruned on read)", async () => {
      vi.useFakeTimers();
      try {
        const now = new Date("2026-10-19T12:00:00.000Z");
        vi.setSystemTime(now);

        const sink = new SinkNotificationAdapter();

        // 1. A message that is already expired when sent is not buffered
        const alreadyExpired = sampleMessage({
          to: "expired-at-write@stealth.mail",
          expiresAt: new Date(now.getTime() - 1000),
        });
        await sink.deliverVerificationEmail(alreadyExpired);
        expect(sink.size).toBe(0);
        expect(sink.capturedMessages).toHaveLength(0);

        // 2. A message that expires after buffering is dropped on read
        const willExpire = sampleMessage({
          to: "expires-soon@stealth.mail",
          expiresAt: new Date(now.getTime() + 5000),
        });
        await sink.deliverVerificationEmail(willExpire);
        expect(sink.size).toBe(1);
        expect(sink.latestMessage?.to).toBe("expires-soon@stealth.mail");

        // Advance past expiry
        vi.advanceTimersByTime(6000);

        expect(sink.size).toBe(0);
        expect(sink.capturedMessages).toHaveLength(0);
        expect(sink.latestMessage).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it("two captures after the buffer is full have distinct refs", async () => {
      const sink = new SinkNotificationAdapter(2);

      const r1 = await sink.deliverVerificationEmail(sampleMessage({ to: "1@stealth.mail" }));
      const r2 = await sink.deliverVerificationEmail(sampleMessage({ to: "2@stealth.mail" }));
      const r3 = await sink.deliverVerificationEmail(sampleMessage({ to: "3@stealth.mail" }));
      const r4 = await sink.deliverVerificationEmail(sampleMessage({ to: "4@stealth.mail" }));

      expect(r1.providerRef).toMatch(/^sink-[0-9a-f-]+$/i);
      expect(r2.providerRef).toMatch(/^sink-[0-9a-f-]+$/i);
      expect(r3.providerRef).toMatch(/^sink-[0-9a-f-]+$/i);
      expect(r4.providerRef).toMatch(/^sink-[0-9a-f-]+$/i);

      // Verify all 4 refs are distinct, non-repeating UUIDs
      const refs = new Set([r1.providerRef, r2.providerRef, r3.providerRef, r4.providerRef]);
      expect(refs.size).toBe(4);
    });

    it("caps retention by maxRetentionMs time as well as count", async () => {
      vi.useFakeTimers();
      try {
        const now = new Date("2026-10-19T12:00:00.000Z");
        vi.setSystemTime(now);

        // Sink with 10s max retention
        const sink = new SinkNotificationAdapter(100, 10_000);

        const msg = sampleMessage({
          to: "retention-cap@stealth.mail",
          expiresAt: new Date(now.getTime() + 60_000), // token valid for 60s
        });
        await sink.deliverVerificationEmail(msg);
        expect(sink.size).toBe(1);

        // Advance 11s (exceeds maxRetentionMs of 10s even though token is not expired)
        vi.advanceTimersByTime(11_000);

        expect(sink.size).toBe(0);
        expect(sink.capturedMessages).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
