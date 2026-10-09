import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";

import { ApiError } from "../../../src/server/api/errors";
import { decodeCursor, encodeCursor } from "../../../src/server/api/pagination";

// Issue #1490: signed opaque pagination cursor.
const SECRET = "test-cursor-secret";

function signedPayload(payload: Record<string, unknown>, version = "1") {
  const raw = JSON.stringify(payload);
  const signature = createHmac("sha256", SECRET).update(raw).digest("hex");
  return `${version}.${signature}.${Buffer.from(raw, "utf8").toString("base64url")}`;
}

describe("signed opaque pagination cursor", () => {
  beforeEach(() => {
    process.env.STEALTH_CURSOR_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.STEALTH_CURSOR_SECRET;
  });

  it("round-trips a continuation key for the same actor and scope", () => {
    const cursor = encodeCursor("owner-A", "msg-0000100", "inbox");
    const decoded = decodeCursor(cursor, "owner-A", "inbox");
    expect(decoded.continuationKey).toBe("msg-0000100");
  });

  it("rejects a tampered cursor", () => {
    const cursor = encodeCursor("owner-A", "msg-0000100", "inbox");
    const tampered = `${cursor.slice(0, -2)}zz`;
    expect(() => decodeCursor(tampered, "owner-A", "inbox")).toThrow(/Tampered pagination cursor/);
  });

  it("rejects cross-actor reuse", () => {
    const cursor = encodeCursor("owner-A", "msg-0000100", "inbox");
    expect(() => decodeCursor(cursor, "owner-B", "inbox")).toThrow(/different actor/);
  });

  it("rejects a cursor whose scope (filter) changed", () => {
    const cursor = encodeCursor("owner-A", "msg-0000100", "inbox");
    expect(() => decodeCursor(cursor, "owner-A", "archive")).toThrow(ApiError);
  });

  it("rejects malformed structure", () => {
    expect(() => decodeCursor("not-a-cursor", "owner-A", "inbox")).toThrow(ApiError);
  });

  it("accepts a valid issued-at timestamp and returns it", () => {
    const now = 1_800_000_000_000;
    const cursor = encodeCursor("owner-A", "msg-0000100", "inbox", { issuedAt: now });

    expect(decodeCursor(cursor, "owner-A", "inbox", { maxAgeMs: 1_000, now })).toEqual({
      continuationKey: "msg-0000100",
      issuedAt: now,
    });
  });

  it("rejects an expired issued-at timestamp", () => {
    const now = 1_800_000_000_000;
    const cursor = encodeCursor("owner-A", "msg-0000100", "inbox", { issuedAt: now - 1_001 });

    expect(() => decodeCursor(cursor, "owner-A", "inbox", { maxAgeMs: 1_000, now })).toThrow(
      /expired/i,
    );
  });

  it("rejects an issued-at timestamp beyond the clock-skew allowance", () => {
    const now = 1_800_000_000_000;
    const cursor = encodeCursor("owner-A", "msg-0000100", "inbox", { issuedAt: now + 60_001 });

    expect(() => decodeCursor(cursor, "owner-A", "inbox", { now })).toThrow(/expired/i);
  });

  it("rejects a version 1 cursor without an issued-at timestamp", () => {
    const cursor = signedPayload({ v: 1, key: "msg-0000100", actor: "owner-A", scope: "inbox" });

    expect(() => decodeCursor(cursor, "owner-A", "inbox", { maxAgeMs: 1_000 })).toThrow(/expired/i);
  });

  it("rejects a non-integer version before decoding the payload", () => {
    const cursor = signedPayload(
      { v: 1, key: "msg-0000100", actor: "owner-A", scope: "inbox", iat: Date.now() },
      "1.0",
    );

    expect(() => decodeCursor(cursor, "owner-A", "inbox")).toThrow(/Invalid pagination cursor/i);
  });
});
