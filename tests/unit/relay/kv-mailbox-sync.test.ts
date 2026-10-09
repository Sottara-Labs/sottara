import { describe, expect, it } from "vitest";

import { KvMailboxSyncPersistence } from "@/services/relay/kv-mailbox-sync";
import type { AppendEventInput } from "@/services/relay/mailbox-sync-types";

const ALICE = `G${"A".repeat(55)}`;
const BOB = `G${"B".repeat(55)}`;
const SENDER = `G${"C".repeat(55)}`;

class FakeKvNamespace {
  private readonly values = new Map<string, string>();

  async get(key: string, type: "text" | "json" = "text") {
    const value = this.values.get(key);
    if (value === undefined) return null;
    return type === "json" ? JSON.parse(value) : value;
  }

  async put(key: string, value: string) {
    this.values.set(key, value);
  }

  async delete(key: string) {
    this.values.delete(key);
  }
}

function event(recipient: string, messageId: string): AppendEventInput {
  return {
    type: "upsert",
    messageId,
    occurredAt: "2026-01-01T00:00:00.000Z",
    recipient,
    sender: SENDER,
    ciphertext: "encrypted-body",
  };
}

describe("KvMailboxSyncPersistence", () => {
  it("scopes event logs by recipient", async () => {
    const persistence = new KvMailboxSyncPersistence(new FakeKvNamespace() as never);
    await persistence.appendEvent(event(ALICE, "a".repeat(64)));

    const alice = await persistence.listEvents(ALICE, 0, 10);
    const bob = await persistence.listEvents(BOB, 0, 10);

    expect(alice.events).toHaveLength(1);
    expect(alice.events[0].recipient).toBe(ALICE);
    expect(bob.events).toEqual([]);
    expect(bob.headSeq).toBe(0);
  });

  it("reports page boundaries and the recipient head sequence", async () => {
    const persistence = new KvMailboxSyncPersistence(new FakeKvNamespace() as never);
    await persistence.appendEvent(event(ALICE, "1".repeat(64)));
    await persistence.appendEvent(event(ALICE, "2".repeat(64)));
    await persistence.appendEvent(event(ALICE, "3".repeat(64)));

    const firstPage = await persistence.listEvents(ALICE, 0, 2);
    expect(firstPage.events.map(({ seq }) => seq)).toEqual([1, 2]);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.headSeq).toBe(3);
    expect(firstPage.minSeq).toBe(1);

    const finalPage = await persistence.listEvents(ALICE, 2, 2);
    expect(finalPage.events.map(({ seq }) => seq)).toEqual([3]);
    expect(finalPage.hasMore).toBe(false);
    expect(finalPage.headSeq).toBe(3);
  });

  it("does not duplicate an already delivered upsert", async () => {
    const persistence = new KvMailboxSyncPersistence(new FakeKvNamespace() as never);
    const input = event(ALICE, "f".repeat(64));

    const first = await persistence.appendEvent(input);
    const duplicate = await persistence.appendEvent(input);

    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(duplicate.event).toEqual(first.event);
    expect((await persistence.listEvents(ALICE, 0, 10)).events).toHaveLength(1);
  });
});
