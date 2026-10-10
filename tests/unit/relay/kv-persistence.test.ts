import { describe, expect, it } from "vitest";

import { KvRelayPersistence } from "../../../src/services/relay/kv-persistence";
import { StealthCoordinator } from "../../../src/server/api/stealth-coordinator";
import type { RelayEnvelope } from "../../../src/services/relay/persistence";

class MockKVNamespace {
  public store = new Map<string, string>();

  async get(key: string, type?: "text" | "json") {
    const val = this.store.get(key);
    if (val === undefined) return null;
    if (type === "json") return JSON.parse(val);
    return val;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

class MockDurableObjectNamespace {
  private readonly coordinator = new StealthCoordinator(
    {
      id: { toString: () => "relay-counters" },
      storage: {
        store: new Map<string, unknown>(),
        async get(key: string) {
          return this.store.get(key);
        },
        async put(key: string, value: unknown) {
          this.store.set(key, value);
        },
        async delete(key: string) {
          return this.store.delete(key);
        },
      },
    } as any,
    {},
  );

  idFromName(name: string) {
    return { toString: () => name };
  }

  get() {
    return this.coordinator;
  }
}

function envelope(overrides: Partial<RelayEnvelope> = {}): RelayEnvelope {
  return {
    messageId: "d".repeat(64),
    sender: `G${"A".repeat(55)}`,
    recipient: `G${"B".repeat(55)}`,
    recipientDomain: "example.com",
    payload: "aGVsbG8=",
    ttlMs: 60_000,
    receivedAt: "2026-01-01T00:00:00.000Z",
    admission: {
      policyVersion: 3,
      allowed: true,
      kind: "trusted",
      reason: "sender_allowed",
      rule: "allow",
      requiredPostage: "0",
      source: "chain",
      evaluatedAt: "2026-01-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

describe("KvRelayPersistence admission idempotency (BETA-036)", () => {
  it("round-trips admission evidence with the stored envelope", async () => {
    const persistence = new KvRelayPersistence(new MockKVNamespace() as unknown as KVNamespace);
    await persistence.enqueue(envelope());

    const stored = await persistence.get("d".repeat(64));
    expect(stored?.admission).toEqual(envelope().admission);
    expect(await persistence.getQueueDepth()).toBe(1);
  });

  it("does not rewrite recorded admission evidence on a duplicate enqueue", async () => {
    const persistence = new KvRelayPersistence(new MockKVNamespace() as unknown as KVNamespace);
    await persistence.enqueue(envelope());

    await persistence.enqueue(
      envelope({
        payload: "replaced",
        admission: {
          policyVersion: 99,
          allowed: false,
          kind: "blocked",
          reason: "sender_blocked",
          rule: "block",
          requiredPostage: "0",
          source: "offchain_fallback",
          evaluatedAt: "2026-08-01T00:00:00.000Z",
        },
      }),
    );

    const stored = await persistence.get("d".repeat(64));
    expect(stored?.payload).toBe("aGVsbG8=");
    expect(stored?.admission.kind).toBe("trusted");
    expect(stored?.admission.policyVersion).toBe(3);
    expect(await persistence.getQueueDepth()).toBe(1);
  });

  it("serializes relay counter increments through the coordinator", async () => {
    const persistence = new KvRelayPersistence(
      new MockKVNamespace() as unknown as KVNamespace,
      new MockDurableObjectNamespace() as unknown as DurableObjectNamespace,
    );

    await Promise.all([persistence.recordRetry(), persistence.recordRetry()]);

    expect(await persistence.getRetryCount()).toBe(2);
  });

  it("seeds a coordinator counter from the legacy KV value once", async () => {
    const kv = new MockKVNamespace();
    await kv.put("relay:retry", "4");
    const persistence = new KvRelayPersistence(
      kv as unknown as KVNamespace,
      new MockDurableObjectNamespace() as unknown as DurableObjectNamespace,
    );

    expect(await persistence.getRetryCount()).toBe(4);
    await persistence.recordRetry();
    expect(await persistence.getRetryCount()).toBe(5);
  });
});
