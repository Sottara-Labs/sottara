import { describe, expect, it } from "vitest";

import { KvMailboxSyncPersistence } from "../../../src/services/relay/kv-mailbox-sync";
import type { AppendEventInput } from "../../../src/services/relay/mailbox-sync-types";

class MockKVNamespace {
  private readonly store = new Map<string, string>();

  async get(key: string, type?: "text" | "json") {
    const value = this.store.get(key);
    if (value === undefined) return null;
    if (type === "json") return JSON.parse(value);
    return value;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

const owner = `G${"A".repeat(55)}`;
const otherOwner = `G${"B".repeat(55)}`;
const sender = `G${"C".repeat(55)}`;

function messageId(value: number): string {
  return value.toString(16).padStart(64, "0");
}

function event(ownerAddress: string, id: number): AppendEventInput {
  return {
    type: "upsert",
    messageId: messageId(id),
    recipient: ownerAddress,
    sender,
    occurredAt: "2026-08-19T00:00:00.000Z",
    ciphertext: "aGVsbG8=",
  };
}

function persistence(): KvMailboxSyncPersistence {
  return new KvMailboxSyncPersistence(new MockKVNamespace() as unknown as KVNamespace);
}

describe("KvMailboxSyncPersistence", () => {
  it("keeps event sequences and reads isolated by recipient", async () => {
    const store = persistence();

    const ownerEvent = await store.appendEvent(event(owner, 1));
    const otherEvent = await store.appendEvent(event(otherOwner, 2));

    expect(ownerEvent.event.seq).toBe(1);
    expect(otherEvent.event.seq).toBe(1);
    await expect(store.listEvents(owner, 0, 10)).resolves.toMatchObject({
      events: [ownerEvent.event],
      hasMore: false,
      headSeq: 1,
      minSeq: 1,
    });
    await expect(store.listEvents(otherOwner, 0, 10)).resolves.toMatchObject({
      events: [otherEvent.event],
      hasMore: false,
      headSeq: 1,
      minSeq: 1,
    });
  });

  it("reports pagination state from the recipient event log", async () => {
    const store = persistence();
    await store.appendEvent(event(owner, 1));
    await store.appendEvent(event(owner, 2));
    await store.appendEvent(event(owner, 3));

    await expect(store.listEvents(owner, 0, 2)).resolves.toMatchObject({
      events: [expect.objectContaining({ seq: 1 }), expect.objectContaining({ seq: 2 })],
      hasMore: true,
      headSeq: 3,
      minSeq: 1,
    });
    await expect(store.listEvents(owner, 2, 2)).resolves.toMatchObject({
      events: [expect.objectContaining({ seq: 3 })],
      hasMore: false,
      headSeq: 3,
      minSeq: 1,
    });
  });

  it("returns the existing event when an upsert is appended twice", async () => {
    const store = persistence();
    const input = event(owner, 1);

    const first = await store.appendEvent(input);
    const second = await store.appendEvent(input);

    expect(first.created).toBe(true);
    expect(second).toEqual({ event: first.event, created: false });
    await expect(store.listEvents(owner, 0, 10)).resolves.toMatchObject({
      events: [first.event],
      headSeq: 1,
    });
  });
});
