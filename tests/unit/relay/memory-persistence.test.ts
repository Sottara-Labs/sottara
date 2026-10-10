import { describe, expect, it } from "vitest";

import { MemoryRelayPersistence } from "@/services/relay/memory-persistence";
import type { RelayEnvelope } from "@/services/relay/persistence";

const SENDER = `G${"A".repeat(55)}`;
const RECIPIENT = `G${"B".repeat(55)}`;

function envelope(messageId: string): RelayEnvelope {
  return {
    messageId,
    sender: SENDER,
    recipient: RECIPIENT,
    recipientDomain: "example.com",
    payload: "ciphertext",
    ttlMs: 60_000,
    receivedAt: "2026-01-01T00:00:00.000Z",
    admission: {
      policyVersion: 1,
      allowed: true,
      kind: "trusted",
      reason: "sender_allowed",
      rule: "allow",
      requiredPostage: "0",
      source: "chain",
      evaluatedAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

describe("MemoryRelayPersistence dequeue lifecycle", () => {
  it("removes drained messages from lookup storage", async () => {
    const persistence = new MemoryRelayPersistence();
    const message = envelope("a".repeat(64));

    await persistence.enqueue(message);
    expect(await persistence.get(message.messageId)).toEqual(message);
    expect(await persistence.dequeue()).toEqual(message);
    expect(await persistence.get(message.messageId)).toBeNull();
    expect(await persistence.getQueueDepth()).toBe(0);
  });

  it("keeps lookup storage bounded across enqueue and dequeue cycles", async () => {
    const persistence = new MemoryRelayPersistence();

    for (let i = 0; i < 25; i += 1) {
      const message = envelope(i.toString(16).padStart(64, "0"));
      await persistence.enqueue(message);
      await persistence.dequeue();
      expect(await persistence.get(message.messageId)).toBeNull();
    }

    expect(await persistence.getQueueDepth()).toBe(0);
  });
});
import { describe, expect, it } from "vitest";

import { MemoryRelayPersistence } from "../../../src/services/relay/memory-persistence";
import type { RelayEnvelope } from "../../../src/services/relay/persistence";

function envelope(messageId: string): RelayEnvelope {
  return {
    messageId,
    sender: `G${"A".repeat(55)}`,
    recipient: `G${"B".repeat(55)}`,
    recipientDomain: "example.com",
    payload: "aGVsbG8=",
    ttlMs: 60_000,
    receivedAt: "2026-01-01T00:00:00.000Z",
    admission: {
      policyVersion: 1,
      allowed: true,
      kind: "trusted",
      reason: "sender_allowed",
      rule: "allow",
      requiredPostage: "0",
      source: "offchain_fallback",
      evaluatedAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

describe("MemoryRelayPersistence active message lifecycle", () => {
  it("removes a drained message from lookup storage", async () => {
    const persistence = new MemoryRelayPersistence();
    const message = envelope("a".repeat(64));

    await persistence.enqueue(message);
    expect(await persistence.get(message.messageId)).toEqual(message);

    await expect(persistence.dequeue()).resolves.toEqual(message);
    await expect(persistence.get(message.messageId)).resolves.toBeNull();
    expect(persistence.getMessage(message.messageId)).toBeUndefined();
    await expect(persistence.getQueueDepth()).resolves.toBe(0);
  });

  it("keeps active storage bounded across repeated enqueue/dequeue cycles", async () => {
    const persistence = new MemoryRelayPersistence();

    for (let cycle = 0; cycle < 100; cycle += 1) {
      const message = envelope(cycle.toString(16).padStart(64, "0"));
      await persistence.enqueue(message);
      await persistence.dequeue();
      expect(persistence.getMessage(message.messageId)).toBeUndefined();
    }

    await expect(persistence.getQueueDepth()).resolves.toBe(0);
  });
});
