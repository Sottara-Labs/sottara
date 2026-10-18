import { describe, expect, it } from "vitest";

import type { VerificationEmailMessage } from "../../../src/services/notifications/adapter";
import { SinkNotificationAdapter } from "../../../src/services/notifications/sink";

function sampleMessage(
  overrides: Partial<VerificationEmailMessage> = {},
): VerificationEmailMessage {
  return {
    to: "alice@stealth.mail",
    purpose: "email_verification",
    verificationUrl: "https://stealth.mail/verify?email=alice%40stealth.mail&token=abc",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    ...overrides,
  };
}

describe("BETA-005: SinkNotificationAdapter (development capture sink)", () => {
  it("accepts every message and records a receipt", async () => {
    const sink = new SinkNotificationAdapter();
    const receipt = await sink.deliverVerificationEmail(sampleMessage());

    expect(receipt).toMatchObject({ transport: "sink", accepted: true });
    expect(receipt.safeTargetReference).toMatch(/^[a-f0-9]{64}$/);
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
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
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

  it("drops expired captures so they are no longer returned", async () => {
    const sink = new SinkNotificationAdapter();
    const pastExpiresAt = new Date(Date.now() - 5000);
    await sink.deliverVerificationEmail(sampleMessage({ expiresAt: pastExpiresAt }));

    expect(sink.size).toBe(0);
    expect(sink.capturedMessages).toHaveLength(0);
    expect(sink.latestMessage).toBeNull();
  });

  it("prunes messages on read when they expire while in the buffer", async () => {
    const sink = new SinkNotificationAdapter();
    const shortLivedExpiresAt = new Date(Date.now() + 30);
    await sink.deliverVerificationEmail(sampleMessage({ expiresAt: shortLivedExpiresAt }));

    expect(sink.size).toBe(1);
    expect(sink.latestMessage).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(sink.size).toBe(0);
    expect(sink.capturedMessages).toHaveLength(0);
    expect(sink.latestMessage).toBeNull();
  });

  it("drops captures when time retention limit (maxRetentionMs) is reached", async () => {
    const sink = new SinkNotificationAdapter(10, 30);
    await sink.deliverVerificationEmail(sampleMessage({ expiresAt: new Date(Date.now() + 10000) }));

    expect(sink.size).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(sink.size).toBe(0);
    expect(sink.capturedMessages).toHaveLength(0);
  });

  it("assigns distinct UUID providerRefs even after the buffer is full", async () => {
    const bufferCapacity = 2;
    const sink = new SinkNotificationAdapter(bufferCapacity);

    await sink.deliverVerificationEmail(sampleMessage({ to: "1@stealth.mail" }));
    await sink.deliverVerificationEmail(sampleMessage({ to: "2@stealth.mail" }));

    const receipt3 = await sink.deliverVerificationEmail(sampleMessage({ to: "3@stealth.mail" }));
    const receipt4 = await sink.deliverVerificationEmail(sampleMessage({ to: "4@stealth.mail" }));

    expect(receipt3.providerRef).toBeDefined();
    expect(receipt4.providerRef).toBeDefined();
    expect(receipt3.providerRef).not.toBe(receipt4.providerRef);
    expect(receipt3.providerRef).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(receipt4.providerRef).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
