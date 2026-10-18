import { describe, it, expect, beforeEach } from "vitest";
import {
  NotificationAuditTrail,
  DEFAULT_AUDIT_KEY_CONFIG,
} from "../../../src/services/notifications/audit-trail";

describe("BETA-005: Notification Audit Trail", () => {
  let auditTrail: NotificationAuditTrail;

  beforeEach(() => {
    auditTrail = new NotificationAuditTrail(50);
    auditTrail.clear();
  });

  it("records delivery events with increasing sequence IDs, valid timestamps, and keyId", async () => {
    const event = await auditTrail.recordEvent({
      eventType: "delivery.dispatched",
      transport: "smtp",
      safeTargetReference: "hash_alice_123",
      durationMs: 45,
      metadata: { priority: "high" },
    });

    expect(event.sequenceId).toBe(1);
    expect(event.eventType).toBe("delivery.dispatched");
    expect(event.transport).toBe("smtp");
    expect(event.safeTargetReference).toBe("hash_alice_123");
    expect(event.durationMs).toBe(45);
    expect(event.recordHash).toBeDefined();
    expect(event.keyId).toBe(DEFAULT_AUDIT_KEY_CONFIG.keyId);
    expect(event.previousHash).toContain("GENESIS_AUDIT_BLOCK");
  });

  it("creates a cryptographically-linked chain across multiple events", async () => {
    const event1 = await auditTrail.recordEvent({
      eventType: "delivery.dispatched",
      transport: "smtp",
      safeTargetReference: "ref_1",
      durationMs: 10,
    });

    const event2 = await auditTrail.recordEvent({
      eventType: "delivery.succeeded",
      transport: "smtp",
      safeTargetReference: "ref_1",
      providerRef: "smtp-msg-001",
      durationMs: 120,
    });

    expect(event2.sequenceId).toBe(2);
    expect(event2.previousHash).toBe(event1.recordHash);

    const isValid = await auditTrail.verifyChainIntegrity();
    expect(isValid).toBe(true);
  });

  it("detects tampering when an event hash is corrupted", async () => {
    await auditTrail.recordEvent({
      eventType: "delivery.dispatched",
      transport: "smtp",
      safeTargetReference: "ref_1",
      durationMs: 10,
    });

    await auditTrail.recordEvent({
      eventType: "delivery.succeeded",
      transport: "smtp",
      safeTargetReference: "ref_1",
      durationMs: 50,
    });

    // Mutate internal state to simulate tampering
    (auditTrail as any).events[0].durationMs = 9999;

    const isValid = await auditTrail.verifyChainIntegrity();
    expect(isValid).toBe(false);
  });

  it("fails verification when an event is edited and recomputed with unkeyed SHA-256", async () => {
    await auditTrail.recordEvent({
      eventType: "delivery.dispatched",
      transport: "smtp",
      safeTargetReference: "ref_1",
      durationMs: 10,
    });
    await auditTrail.recordEvent({
      eventType: "delivery.succeeded",
      transport: "smtp",
      safeTargetReference: "ref_1",
      durationMs: 20,
    });

    expect(await auditTrail.verifyChainIntegrity()).toBe(true);

    // Tamper with first event durationMs and recompute recordHash with plain unkeyed SHA-256
    const tamperedEvent = (auditTrail as any).events[0];
    tamperedEvent.durationMs = 9999;
    const payloadToHash = JSON.stringify({
      sequence: tamperedEvent.sequenceId,
      eventType: tamperedEvent.eventType,
      transport: tamperedEvent.transport,
      target: tamperedEvent.safeTargetReference,
      ref: tamperedEvent.providerRef ?? "",
      msgId: tamperedEvent.messageId ?? "",
      duration: tamperedEvent.durationMs,
      ts: tamperedEvent.timestamp,
      prev: tamperedEvent.previousHash,
      keyId: tamperedEvent.keyId,
      meta: tamperedEvent.metadata ?? {},
    });

    const { createHash } = await import("node:crypto");
    tamperedEvent.recordHash = createHash("sha256").update(payloadToHash).digest("hex");

    // Also update second event previousHash to point to new hash
    (auditTrail as any).events[1].previousHash = tamperedEvent.recordHash;

    const isValid = await auditTrail.verifyChainIntegrity();
    expect(isValid).toBe(false);
  });

  it("fails verification when verified with the wrong key", async () => {
    await auditTrail.recordEvent({
      eventType: "delivery.dispatched",
      transport: "smtp",
      safeTargetReference: "ref_1",
      durationMs: 10,
    });

    expect(await auditTrail.verifyChainIntegrity()).toBe(true);

    const wrongSecretResult = await auditTrail.verifyChainIntegrity({
      keyId: "audit-key-v1",
      secret: "wrong-secret-key-that-does-not-match",
    });
    expect(wrongSecretResult).toBe(false);

    const wrongKeyIdResult = await auditTrail.verifyChainIntegrity({
      keyId: "different-key-id",
      secret: "stealth-notification-audit-secret-v1",
    });
    expect(wrongKeyIdResult).toBe(false);
  });

  it("supports key configuration and rotation", async () => {
    const rotatedTrail = new NotificationAuditTrail(50, {
      keyId: "audit-key-v2-2026-q4",
      secret: "custom-rotated-secret-key-32-bytes!!",
    });

    const event = await rotatedTrail.recordEvent({
      eventType: "delivery.dispatched",
      transport: "smtp",
      safeTargetReference: "ref_rotated",
      durationMs: 15,
    });

    expect(event.keyId).toBe("audit-key-v2-2026-q4");
    expect(await rotatedTrail.verifyChainIntegrity()).toBe(true);
    expect(
      await rotatedTrail.verifyChainIntegrity({
        keyId: "audit-key-v2-2026-q4",
        secret: "custom-rotated-secret-key-32-bytes!!",
      }),
    ).toBe(true);
    expect(
      await rotatedTrail.verifyChainIntegrity({
        keyId: "audit-key-v1",
        secret: "custom-rotated-secret-key-32-bytes!!",
      }),
    ).toBe(false);
  });

  it("produces accurate statistical summaries", async () => {
    await auditTrail.recordEvent({
      eventType: "delivery.succeeded",
      transport: "smtp",
      safeTargetReference: "ref_a",
      durationMs: 100,
    });

    await auditTrail.recordEvent({
      eventType: "delivery.failed",
      transport: "smtp",
      safeTargetReference: "ref_b",
      durationMs: 200,
    });

    await auditTrail.recordEvent({
      eventType: "delivery.succeeded",
      transport: "sink",
      safeTargetReference: "ref_c",
      durationMs: 10,
    });

    const summary = await auditTrail.getSummary();
    expect(summary.totalEvents).toBe(3);
    expect(summary.successfulDeliveries).toBe(2);
    expect(summary.failedDeliveries).toBe(1);
    expect(summary.averageLatencyMs).toBe(103);
    expect(summary.transportBreakdown.smtp).toBe(2);
    expect(summary.transportBreakdown.sink).toBe(1);
    expect(summary.verifiedChainIntegrity).toBe(true);
  });

  it("filters events by safe target reference", async () => {
    await auditTrail.recordEvent({
      eventType: "delivery.dispatched",
      transport: "smtp",
      safeTargetReference: "target_target_alpha",
      durationMs: 20,
    });

    await auditTrail.recordEvent({
      eventType: "delivery.dispatched",
      transport: "smtp",
      safeTargetReference: "target_target_beta",
      durationMs: 30,
    });

    const alphaEvents = auditTrail.findEventsByTarget("target_target_alpha");
    expect(alphaEvents).toHaveLength(1);
    expect(alphaEvents[0].safeTargetReference).toBe("target_target_alpha");
  });
});
