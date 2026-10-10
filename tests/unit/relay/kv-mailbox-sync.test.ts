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
import { describe, expect, it } from "vitest";

import { KvMailboxSyncPersistence } from "@/services/relay/kv-mailbox-sync";
import type { AppendEventInput } from "@/services/relay/mailbox-sync-types";

/** Minimal in-memory stand-in for the Cloudflare KVNamespace surface this class uses. */
class FakeKv {
  private readonly store = new Map<string, string>();

  async get(key: string, type?: "text" | "json"): Promise<unknown> {
    const raw = this.store.has(key) ? (this.store.get(key) as string) : null;
    if (raw === null) return null;
    return type === "json" ? (JSON.parse(raw) as unknown) : raw;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

const alice = `G${"A".repeat(55)}`;
const bob = `G${"B".repeat(55)}`;

function upsert(recipient: string, messageId: string): AppendEventInput {
  return {
    type: "upsert",
    messageId,
    occurredAt: "2026-10-01T00:00:00.000Z",
    recipient,
    ciphertext: "aGVsbG8=",
  };
}

function hexId(seed: string): string {
  return seed.repeat(64).slice(0, 64);
}

function makePersistence() {
  const kv = new FakeKv();
  return new KvMailboxSyncPersistence(kv as unknown as KVNamespace);
}

describe("KvMailboxSyncPersistence", () => {
  it("scopes events to the recipient: alice's events are invisible to bob", async () => {
    const persistence = makePersistence();

    await persistence.appendEvent(upsert(alice, hexId("a")));
    await persistence.appendEvent(upsert(alice, hexId("b")));
    await persistence.appendEvent(upsert(bob, hexId("c")));

    const aliceView = await persistence.listEvents(alice, 0, 10);
    expect(aliceView.events).toHaveLength(2);
    expect(aliceView.events.map((event) => event.recipient)).toEqual([alice, alice]);

    const bobView = await persistence.listEvents(bob, 0, 10);
    expect(bobView.events).toHaveLength(1);
    expect(bobView.events[0].recipient).toBe(bob);
    expect(bobView.events[0].messageId).toBe(hexId("c"));
  });

  it("paginates with hasMore and headSeq", async () => {
    const persistence = makePersistence();
    for (let i = 0; i < 5; i += 1) {
      await persistence.appendEvent(upsert(alice, String(i).padStart(64, "0")));
    }

    const page1 = await persistence.listEvents(alice, 0, 2);
    expect(page1.events.map((event) => event.seq)).toEqual([1, 2]);
    expect(page1.hasMore).toBe(true);
    expect(page1.headSeq).toBe(5);

    const page2 = await persistence.listEvents(alice, 2, 2);
    expect(page2.events.map((event) => event.seq)).toEqual([3, 4]);
    expect(page2.hasMore).toBe(true);

    const page3 = await persistence.listEvents(alice, 4, 2);
    expect(page3.events.map((event) => event.seq)).toEqual([5]);
    expect(page3.hasMore).toBe(false);
    expect(page3.headSeq).toBe(5);
  });

  it("treats a repeated upsert as idempotent and does not advance the head", async () => {
    const persistence = makePersistence();
    const messageId = hexId("d");

    const first = await persistence.appendEvent(upsert(alice, messageId));
    expect(first.created).toBe(true);
    expect(first.event.seq).toBe(1);

    const second = await persistence.appendEvent(upsert(alice, messageId));
    expect(second.created).toBe(false);
    expect(second.event.seq).toBe(1);

    const view = await persistence.listEvents(alice, 0, 10);
    expect(view.events).toHaveLength(1);
    expect(view.headSeq).toBe(1);
  });
});
