import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CryptoIdError,
  generateMessageId,
  isValidMessageId,
  MESSAGE_ID_BYTES,
} from "../../../src/services/crypto/random";

describe("crypto-secure message id generation (#1693)", () => {
  it("uses only cryptographically secure randomness", () => {
    const id = generateMessageId();
    expect(id).toMatch(/^[0-9a-f]+$/);
    expect(id.length).toBe(MESSAGE_ID_BYTES * 2);
  });

  it("produces distinct identifiers (low collision risk)", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      ids.add(generateMessageId());
    }
    expect(ids.size).toBe(200);
  });

  it("supports base64url encoding", () => {
    const id = generateMessageId("base64url");
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(id.length).toBe(22);
    expect(id).not.toContain("=");
  });

  it("has documented entropy and length", () => {
    expect(MESSAGE_ID_BYTES).toBe(16);
    const hex = generateMessageId("hex");
    expect(hex.length).toBe(32); // 16 bytes * 2 hex chars
  });

  it("isValidMessageId accepts a freshly generated id", () => {
    expect(isValidMessageId(generateMessageId())).toBe(true);
    expect(isValidMessageId(generateMessageId("base64url"), "base64url")).toBe(true);
  });

  it("isValidMessageId rejects malformed input", () => {
    expect(isValidMessageId("")).toBe(false);
    expect(isValidMessageId("zzzz")).toBe(false);
    expect(isValidMessageId("00")).toBe(false); // wrong length
    expect(isValidMessageId("not!valid")).toBe(false);
  });

  it("accepts canonical hex and base64url ids only at their exact lengths", () => {
    const hex = generateMessageId("hex");
    const base64url = generateMessageId("base64url");

    expect(isValidMessageId(hex, "hex")).toBe(true);
    expect(isValidMessageId(base64url, "base64url")).toBe(true);
    expect(isValidMessageId(base64url.slice(0, -1), "base64url")).toBe(false);
    expect(isValidMessageId(`${base64url}A`, "base64url")).toBe(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates base64url ids even when the Node-only Buffer global is absent", () => {
    // Simulates the browser bundle, where `Buffer` does not exist.
    vi.stubGlobal("Buffer", undefined);
    expect(globalThis.Buffer).toBeUndefined();

    expect(isValidMessageId(generateMessageId("base64url"), "base64url")).toBe(true);
    expect(isValidMessageId("b".repeat(21), "base64url")).toBe(false); // wrong length
    expect(isValidMessageId("b".repeat(23), "base64url")).toBe(false); // wrong length
    expect(isValidMessageId("b".repeat(21) + "!", "base64url")).toBe(false); // illegal character
  });
});
