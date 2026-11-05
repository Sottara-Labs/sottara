import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  NotificationCircuitBreaker,
  ResilientNotificationDeliveryService,
  DeadLetterQueue,
} from "../../../src/services/notifications/resilience";
import type {
  NotificationAdapter,
  VerificationEmailMessage,
  DeliveryReceipt,
} from "../../../src/services/notifications/adapter";

describe("BETA-005: Notification Resilience & Circuit Breaker", () => {
  describe("NotificationCircuitBreaker", () => {
    let cb: NotificationCircuitBreaker;

    beforeEach(() => {
      cb = new NotificationCircuitBreaker("smtp", {
        failureThreshold: 3,
        resetTimeoutMs: 100,
        halfOpenMaxTrials: 1,
      });
    });

    it("starts in closed state", () => {
      expect(cb.currentState).toBe("closed");
      expect(cb.isOpen()).toBe(false);
    });

    it("transitions to open state after reaching failure threshold", () => {
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.currentState).toBe("closed");

      cb.recordFailure();
      expect(cb.currentState).toBe("open");
      expect(cb.isOpen()).toBe(true);
    });

    it("transitions to half-open after reset timeout", async () => {
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.currentState).toBe("open");

      await new Promise((r) => setTimeout(r, 110));
      expect(cb.currentState).toBe("half-open");
    });

    it("resets back to closed on success", () => {
      cb.recordFailure();
      cb.recordFailure();
      cb.recordSuccess();
      expect(cb.currentState).toBe("closed");
    });
  });

  describe("DeadLetterQueue", () => {
    it("enqueues and retrieves quarantined entries", () => {
      const dlq = new DeadLetterQueue(10);
      dlq.enqueue({
        id: "entry-1",
        messageSummary: {
          recipientDomain: "example.com",
          safeTargetReference: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          purpose: "email_verification",
        },
        failedAttempts: 3,
        lastError: "SMTP connection refused",
        firstFailedAt: new Date().toISOString(),
        lastFailedAt: new Date().toISOString(),
        transport: "smtp",
      });

      expect(dlq.size).toBe(1);
      const retrieved = dlq.get("entry-1");
      expect(retrieved?.lastError).toBe("SMTP connection refused");
      expect((retrieved?.messageSummary as any).to).toBeUndefined();
      expect(retrieved?.messageSummary.recipientDomain).toBe("example.com");
      expect(retrieved?.messageSummary.safeTargetReference).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(retrieved?.messageSummary)).not.toContain("@");
      expect(dlq.remove("entry-1")).toBe(true);
      expect(dlq.size).toBe(0);
    });
  });

  describe("ResilientNotificationDeliveryService", () => {
    it("successfully delivers on first attempt when inner adapter succeeds", async () => {
      const mockAdapter: NotificationAdapter = {
        transport: "smtp",
        deliverVerificationEmail: vi.fn().mockResolvedValue({
          transport: "smtp",
          accepted: true,
          providerRef: "smtp-mock-123",
          safeTargetReference: "target-ref-1",
        }),
      };

      const resilientService = new ResilientNotificationDeliveryService(mockAdapter, {
        maxRetries: 2,
        initialDelayMs: 10,
        maxDelayMs: 50,
        backoffFactor: 2,
      });

      const message: VerificationEmailMessage = {
        to: "alice@stealth.mail",
        purpose: "email_verification",
        verificationUrl: "https://stealth.mail/verify?token=abc",
        expiresAt: new Date(Date.now() + 3600000),
      };

      const receipt = await resilientService.deliverVerificationEmail(message);
      expect(receipt.accepted).toBe(true);
      expect(receipt.providerRef).toBe("smtp-mock-123");
      expect(mockAdapter.deliverVerificationEmail).toHaveBeenCalledTimes(1);
    });

    it("retries on transient failure and recovers", async () => {
      let callCount = 0;
      const mockAdapter: NotificationAdapter = {
        transport: "smtp",
        deliverVerificationEmail: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.reject(new Error("Transient socket timeout"));
          }
          return Promise.resolve({
            transport: "smtp",
            accepted: true,
            providerRef: "smtp-mock-recovered",
            safeTargetReference: "target-ref-1",
          });
        }),
      };

      const resilientService = new ResilientNotificationDeliveryService(mockAdapter, {
        maxRetries: 2,
        initialDelayMs: 10,
        maxDelayMs: 50,
        backoffFactor: 1.5,
      });

      const message: VerificationEmailMessage = {
        to: "bob@stealth.mail",
        purpose: "email_verification",
        verificationUrl: "https://stealth.mail/verify?token=abc",
        expiresAt: new Date(Date.now() + 3600000),
      };

      const receipt = await resilientService.deliverVerificationEmail(message);
      expect(receipt.accepted).toBe(true);
      expect(callCount).toBe(2);
    });

    it("enqueues to DLQ and trips circuit breaker on persistent failure", async () => {
      const mockAdapter: NotificationAdapter = {
        transport: "smtp",
        deliverVerificationEmail: vi.fn().mockRejectedValue(new Error("Permanent SMTP Error 550")),
      };

      const resilientService = new ResilientNotificationDeliveryService(
        mockAdapter,
        { maxRetries: 2, initialDelayMs: 5, maxDelayMs: 20, backoffFactor: 1 },
        { failureThreshold: 1, resetTimeoutMs: 1000, halfOpenMaxTrials: 1 },
      );

      const message: VerificationEmailMessage = {
        to: "charlie@stealth.mail",
        purpose: "email_verification",
        verificationUrl: "https://stealth.mail/verify?token=abc",
        expiresAt: new Date(Date.now() + 3600000),
      };

      const receipt = await resilientService.deliverVerificationEmail(message);
      expect(receipt.accepted).toBe(false);
      expect(receipt.reasonClass).toBe("max_retries_exceeded");
      expect(resilientService.dlq.size).toBe(1);

      const entries = resilientService.dlq.getAll();
      expect(entries).toHaveLength(1);
      const entry = entries[0];
      expect((entry.messageSummary as any).to).toBeUndefined();
      expect(entry.messageSummary.recipientDomain).toBe("stealth.mail");
      expect(entry.messageSummary.safeTargetReference).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(entry.messageSummary)).not.toContain("@");
      expect(JSON.stringify(entry.messageSummary)).not.toContain("charlie");
    });

    it("ensures circuit breaker DLQ entry contains no local-part or @ and safeTargetReference is a digest", async () => {
      const mockAdapter: NotificationAdapter = {
        transport: "smtp",
        deliverVerificationEmail: vi.fn().mockRejectedValue(new Error("Down")),
      };

      const resilientService = new ResilientNotificationDeliveryService(
        mockAdapter,
        { maxRetries: 0, initialDelayMs: 1, maxDelayMs: 1, backoffFactor: 1 },
        { failureThreshold: 1, resetTimeoutMs: 60_000, halfOpenMaxTrials: 1 },
      );

      // First call trips circuit breaker to open
      await resilientService.deliverVerificationEmail({
        to: "first@stealth.mail",
        purpose: "email_verification",
        verificationUrl: "https://stealth.mail/verify?token=1",
        expiresAt: new Date(Date.now() + 3600000),
      });

      expect(resilientService.circuitState).toBe("open");

      // Second call hits open circuit breaker and enqueues to DLQ immediately
      const secondReceipt = await resilientService.deliverVerificationEmail({
        to: "sensitive.user@private.domain.com",
        purpose: "password_reset",
        verificationUrl: "https://stealth.mail/verify?token=2",
        expiresAt: new Date(Date.now() + 3600000),
      });

      expect(secondReceipt.accepted).toBe(false);
      expect(secondReceipt.reasonClass).toBe("circuit_breaker_open");

      const entries = resilientService.dlq.getAll();
      expect(entries.length).toBeGreaterThanOrEqual(2);
      const cbEntry = entries[entries.length - 1];

      expect((cbEntry.messageSummary as any).to).toBeUndefined();
      expect(cbEntry.messageSummary.recipientDomain).toBe("private.domain.com");
      expect(cbEntry.messageSummary.safeTargetReference).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(cbEntry.messageSummary)).not.toContain("@");
      expect(JSON.stringify(cbEntry.messageSummary)).not.toContain("sensitive.user");
    });
  });
});
