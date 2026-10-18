import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../../../src/server/api/errors";
import {
  decodeMailboxCursor,
  encodeMailboxCursor,
} from "../../../src/services/relay/mailbox-cursor";
import { SYNC_CURSOR_TTL_MS } from "../../../src/services/relay/mailbox-sync-types";

const SECRET = "test-mailbox-cursor-secret";
const actor = `G${"A".repeat(55)}`;
const deviceId = "device-one";

describe("durable mailbox sync cursor", () => {
  beforeEach(() => {
    process.env.STEALTH_CURSOR_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.STEALTH_CURSOR_SECRET;
  });

  it("imports nothing from node:* and does not use the Buffer global", () => {
    const source = readFileSync(
      new URL("../../../src/services/relay/mailbox-cursor.ts", import.meta.url),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/from\s+["']node:/);
    expect(code).not.toMatch(/\bBuffer\b/);
  });

  it("round-trips actor, device, and seq", async () => {
    const cursor = await encodeMailboxCursor(actor, deviceId, 12, 1_000);
    const decoded = await decodeMailboxCursor(cursor, actor, deviceId, 1_001);
    expect(decoded).toMatchObject({ actor, deviceId, seq: 12 });
    expect(decoded.expiresAt).toBe(1_000 + SYNC_CURSOR_TTL_MS);
  });

  it("produces byte-identical cursors for identical input", async () => {
    const first = await encodeMailboxCursor(actor, deviceId, 12, 1_000);
    const second = await encodeMailboxCursor(actor, deviceId, 12, 1_000);
    expect(second).toBe(first);
  });

  it("rejects a tampered cursor", async () => {
    const cursor = await encodeMailboxCursor(actor, deviceId, 1, 1_000);
    await expect(
      decodeMailboxCursor(`${cursor.slice(0, -2)}zz`, actor, deviceId, 1_001),
    ).rejects.toThrow(/Tampered mailbox sync cursor/);
  });

  it("rejects cross-actor reuse", async () => {
    const cursor = await encodeMailboxCursor(actor, deviceId, 1, 1_000);
    await expect(
      decodeMailboxCursor(cursor, `G${"B".repeat(55)}`, deviceId, 1_001),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("rejects a cursor bound to a different device", async () => {
    const cursor = await encodeMailboxCursor(actor, deviceId, 1, 1_000);
    await expect(decodeMailboxCursor(cursor, actor, "device-two", 1_001)).rejects.toThrow(
      /different device/,
    );
  });

  it("expires after the configured TTL", async () => {
    const issuedAt = 1_000;
    const cursor = await encodeMailboxCursor(actor, deviceId, 4, issuedAt, 50);
    const error = await decodeMailboxCursor(cursor, actor, deviceId, issuedAt + 50).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ code: "cursor_expired", status: 410 });
  });
});
