import { describe, expect, it } from "vitest";

import { KvRelayPersistence } from "../../../src/services/relay/kv-persistence";
import { StealthCoordinator } from "../../../src/server/api/stealth-coordinator";
import type { RelayEnvelope } from "../../../src/services/relay/persistence";

class MockKVNamespace {
  public store = new Map<string, string>();
  public listPages: Array<{
    keys: Array<{ name: string }>;
    list_complete: boolean;
    cursor?: string;
  }> = [{ keys: [], list_complete: true }];
  public listCalls: Array<{ prefix?: string; cursor?: string }> = [];
  public getCalls: string[] = [];

  async get(key: string, type?: "text" | "json") {
    this.getCalls.push(key);
    const val = this.store.get(key);
    if (val === undefined) return null;
    if (type === "json") return JSON.parse(val);
    return val;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options: { prefix?: string; cursor?: string; limit?: number }) {
    this.listCalls.push(options);
    if (this.listPages.length > 0) {
      const page = this.listPages.shift()!;
      if (page.keys.length > 0) return page;
    }
    const prefix = options.prefix ?? "";
    const keys = [...this.store.keys()]
      .filter((key) => key.startsWith(prefix))
      .slice(0, options.limit ?? 1000)
      .map((name) => ({ name }));
    return { keys, list_complete: true };
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

function seedMessage(kv: MockKVNamespace, value: RelayEnvelope): string {
  const key = `relay:message:${value.messageId}`;
  kv.store.set(key, JSON.stringify(value));
  return key;
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

describe("KvRelayPersistence.listRecipientQueue pagination", () => {
  it("returns an empty queue when the KV prefix has no keys", async () => {
    const kv = new MockKVNamespace();
    const persistence = new KvRelayPersistence(kv as unknown as KVNamespace);

    await expect(persistence.listRecipientQueue(envelope().recipient)).resolves.toEqual([]);
    expect(kv.listCalls).toHaveLength(1);
    expect(kv.listCalls[0]).toEqual({ prefix: "relay:message:" });
  });

  it("reads a single page using the existing message-key layout", async () => {
    const kv = new MockKVNamespace();
    const first = envelope({ messageId: "1".repeat(64) });
    const key = seedMessage(kv, first);
    kv.listPages = [{ keys: [{ name: key }], list_complete: true }];
    const persistence = new KvRelayPersistence(kv as unknown as KVNamespace);

    await expect(persistence.listRecipientQueue(first.recipient)).resolves.toEqual([first]);
    expect(kv.getCalls).toContain(key);
  });

  it("preserves messages from two pages for the same recipient", async () => {
    const kv = new MockKVNamespace();
    const first = envelope({ messageId: "1".repeat(64) });
    const second = envelope({ messageId: "2".repeat(64) });
    const firstKey = seedMessage(kv, first);
    const secondKey = seedMessage(kv, second);
    kv.listPages = [
      { keys: [{ name: firstKey }], list_complete: false, cursor: "page-2" },
      { keys: [{ name: secondKey }], list_complete: true },
    ];
    const persistence = new KvRelayPersistence(kv as unknown as KVNamespace);

    await expect(persistence.listRecipientQueue(first.recipient)).resolves.toEqual([first, second]);
    expect(kv.listCalls).toEqual([
      { prefix: "relay:message:" },
      { prefix: "relay:message:", cursor: "page-2" },
    ]);
  });

  it("finds a recipient whose only message is on the second page", async () => {
    const kv = new MockKVNamespace();
    const other = envelope({ messageId: "1".repeat(64) });
    const target = envelope({ messageId: "2".repeat(64), recipient: `G${"C".repeat(55)}` });
    const otherKey = seedMessage(kv, other);
    const targetKey = seedMessage(kv, target);
    kv.listPages = [
      { keys: [{ name: otherKey }], list_complete: false, cursor: "page-2" },
      { keys: [{ name: targetKey }], list_complete: true },
    ];
    const persistence = new KvRelayPersistence(kv as unknown as KVNamespace);

    await expect(persistence.listRecipientQueue(target.recipient)).resolves.toEqual([target]);
  });

  it("filters messages for different recipients while retaining legacy key reads", async () => {
    const kv = new MockKVNamespace();
    const target = envelope({ messageId: "1".repeat(64) });
    const other = envelope({ messageId: "2".repeat(64), recipient: `G${"C".repeat(55)}` });
    const targetKey = seedMessage(kv, target);
    const otherKey = seedMessage(kv, other);
    kv.listPages = [{ keys: [{ name: targetKey }, { name: otherKey }], list_complete: true }];
    const persistence = new KvRelayPersistence(kv as unknown as KVNamespace);

    await expect(persistence.listRecipientQueue(target.recipient)).resolves.toEqual([target]);
    // Existing global message keys require reading envelope contents to filter by recipient.
    expect(kv.getCalls).toEqual([targetKey, otherKey]);
  });

  it("normalizes the requested recipient and stored recipient", async () => {
    const kv = new MockKVNamespace();
    const target = envelope({ messageId: "1".repeat(64) });
    const key = seedMessage(kv, target);
    kv.listPages = [{ keys: [{ name: key }], list_complete: true }];
    const persistence = new KvRelayPersistence(kv as unknown as KVNamespace);

    await expect(
      persistence.listRecipientQueue(`  ${target.recipient.toLowerCase()}  `),
    ).resolves.toEqual([target]);
  });

  it("stops after a final empty page and preserves earlier results", async () => {
    const kv = new MockKVNamespace();
    const target = envelope({ messageId: "1".repeat(64) });
    const key = seedMessage(kv, target);
    kv.listPages = [
      { keys: [{ name: key }], list_complete: false, cursor: "page-2" },
      { keys: [], list_complete: true },
    ];
    const persistence = new KvRelayPersistence(kv as unknown as KVNamespace);

    await expect(persistence.listRecipientQueue(target.recipient)).resolves.toEqual([target]);
    expect(kv.listCalls).toHaveLength(2);
  });

  it("stops when KV repeats a cursor without discarding prior-page messages", async () => {
    const kv = new MockKVNamespace();
    const first = envelope({ messageId: "1".repeat(64) });
    const second = envelope({ messageId: "2".repeat(64) });
    const firstKey = seedMessage(kv, first);
    const secondKey = seedMessage(kv, second);
    kv.listPages = [
      { keys: [{ name: firstKey }], list_complete: false, cursor: "repeat" },
      { keys: [{ name: secondKey }], list_complete: false, cursor: "repeat" },
    ];
    const persistence = new KvRelayPersistence(kv as unknown as KVNamespace);

    await expect(persistence.listRecipientQueue(first.recipient)).resolves.toEqual([first, second]);
    expect(kv.listCalls).toHaveLength(2);
  });

  it("stops safely when an incomplete page has no usable cursor", async () => {
    const kv = new MockKVNamespace();
    const target = envelope({ messageId: "1".repeat(64) });
    const key = seedMessage(kv, target);
    kv.listPages = [{ keys: [{ name: key }], list_complete: false }];
    const persistence = new KvRelayPersistence(kv as unknown as KVNamespace);

    await expect(persistence.listRecipientQueue(target.recipient)).resolves.toEqual([target]);
    expect(kv.listCalls).toHaveLength(1);
  });

  it("ignores missing records and duplicate keys across pages", async () => {
    const kv = new MockKVNamespace();
    const target = envelope({ messageId: "1".repeat(64) });
    const key = seedMessage(kv, target);
    const missingKey = "relay:message:missing";
    kv.listPages = [
      {
        keys: [{ name: key }, { name: missingKey }],
        list_complete: false,
        cursor: "page-2",
      },
      { keys: [{ name: key }], list_complete: true },
    ];
    const persistence = new KvRelayPersistence(kv as unknown as KVNamespace);

    await expect(persistence.listRecipientQueue(target.recipient)).resolves.toEqual([target]);
    expect(kv.getCalls).toEqual([key, missingKey]);
  });

  it("dequeues messages and restores queue depth", async () => {
    const kv = new MockKVNamespace();
    const persistence = new KvRelayPersistence(kv as unknown as KVNamespace);
    const first = envelope({ messageId: "1".padStart(64, "0") });
    const second = envelope({ messageId: "2".padStart(64, "0") });

    await persistence.enqueue(first);
    await persistence.enqueue(second);
    expect(await persistence.getQueueDepth()).toBe(2);

    await expect(persistence.dequeue()).resolves.toEqual(first);
    expect(await persistence.get(first.messageId)).toBeNull();
    expect(await persistence.getQueueDepth()).toBe(1);

    await expect(persistence.dequeue()).resolves.toEqual(second);
    await expect(persistence.dequeue()).resolves.toBeNull();
    expect(await persistence.getQueueDepth()).toBe(0);
  });
});
