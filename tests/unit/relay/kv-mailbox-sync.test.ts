import { describe, expect, it } from "vitest";

import { KvMailboxSyncPersistence } from "../../../src/services/relay/kv-mailbox-sync";
import type { AppendEventInput } from "../../../src/services/relay/mailbox-sync-types";

class MockKVNamespace {
  readonly store = new Map<string, string>();

  async get(key: string, type?: "text" | "json") {
    const value = this.store.get(key);
    if (value === undefined) return null;
    return type === "json" ? JSON.parse(value) : value;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

const ALICE = `G${"A".repeat(55)}`;
const BOB = `G${"B".repeat(55)}`;

function event(overrides: Partial<AppendEventInput> = {}): AppendEventInput {
  return {
    type: "upsert",
    messageId: "a".repeat(64),
    occurredAt: "2026-08-17T10:00:00.000Z",
    recipient: ALICE,
    sender: BOB,
    ciphertext: "encrypted-payload",
    ...overrides,
  };
}

describe("KvMailboxSyncPersistence", () => {
  it("scopes events and sequence counters to each recipient", async () => {
    const persistence = new KvMailboxSyncPersistence(
      new MockKVNamespace() as unknown as KVNamespace,
    );

    await persistence.appendEvent(event());
    await persistence.appendEvent(event({ recipient: BOB, messageId: "b".repeat(64) }));

    await expect(persistence.listEvents(ALICE, 0, 10)).resolves.toMatchObject({
      events: [expect.objectContaining({ recipient: ALICE, seq: 1 })],
      hasMore: false,
      headSeq: 1,
      minSeq: 1,
    });
    await expect(persistence.listEvents(BOB, 0, 10)).resolves.toMatchObject({
      events: [expect.objectContaining({ recipient: BOB, seq: 1 })],
      hasMore: false,
      headSeq: 1,
      minSeq: 1,
    });
  });

  it("reports hasMore and headSeq from the recipient's cursor", async () => {
    const persistence = new KvMailboxSyncPersistence(
      new MockKVNamespace() as unknown as KVNamespace,
    );
    await persistence.appendEvent(event({ messageId: "a".repeat(64) }));
    await persistence.appendEvent(event({ messageId: "b".repeat(64) }));
    await persistence.appendEvent(event({ messageId: "c".repeat(64) }));

    const firstPage = await persistence.listEvents(ALICE, 0, 2);
    expect(firstPage.events.map((item) => item.seq)).toEqual([1, 2]);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.headSeq).toBe(3);
    expect(firstPage.minSeq).toBe(1);

    const secondPage = await persistence.listEvents(ALICE, 2, 2);
    expect(secondPage.events.map((item) => item.seq)).toEqual([3]);
    expect(secondPage.hasMore).toBe(false);
    expect(secondPage.headSeq).toBe(3);
  });

  it("returns the original event when an upsert is appended twice", async () => {
    const persistence = new KvMailboxSyncPersistence(
      new MockKVNamespace() as unknown as KVNamespace,
    );

    const first = await persistence.appendEvent(event());
    const duplicate = await persistence.appendEvent(event({ ciphertext: "different-payload" }));

    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(duplicate.event).toEqual(first.event);
    await expect(persistence.listEvents(ALICE, 0, 10)).resolves.toMatchObject({
      events: [expect.objectContaining({ seq: 1, ciphertext: "encrypted-payload" })],
      headSeq: 1,
    });
  });
});
