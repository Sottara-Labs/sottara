// @vitest-environment jsdom
import { webcrypto } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  decodeMailboxCursor,
  encodeMailboxCursor,
} from "../../../src/services/relay/mailbox-cursor";

const SECRET = "test-mailbox-cursor-secret";
const actor = `G${"A".repeat(55)}`;
const deviceId = "device-one";

describe("mailbox cursor in a browser test environment", () => {
  beforeEach(() => {
    // jsdom exposes some Web Crypto entry points but not always `subtle`; fall
    // back to the standard WebCrypto implementation so this exercises the same
    // browser API surface the module targets.
    if (!globalThis.crypto?.subtle) {
      vi.stubGlobal("crypto", webcrypto);
    }
    process.env.STEALTH_CURSOR_SECRET = SECRET;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.STEALTH_CURSOR_SECRET;
  });

  it("round-trips and is deterministic without Node built-ins", async () => {
    const first = await encodeMailboxCursor(actor, deviceId, 7, 1_000);
    const second = await encodeMailboxCursor(actor, deviceId, 7, 1_000);
    expect(second).toBe(first);

    const decoded = await decodeMailboxCursor(first, actor, deviceId, 1_001);
    expect(decoded).toMatchObject({ actor, deviceId, seq: 7 });
  });
});
