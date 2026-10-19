import { describe, it, expect, vi} from "vitest";
import {
  DEFAULT_MAX_BODY_BYTES,
  resolveBodyLimit,
  validateContentLength,
  readBodyWithLimit,
} from "./request";

describe("resolveBodyLimit", () => {
  it("returns the default limit for an undeclared route key", () => {
    const limit = resolveBodyLimit({ route: "undeclared-route", method: "POST" });
    expect(limit).toBe(DEFAULT_MAX_BODY_BYTES);
  });
});

describe("validateContentLength", () => {
  it("rejects an oversized body for an undeclared route key", () => {
    const limit = resolveBodyLimit({ route: "undeclared-route", method: "POST" });
    const declaredLength = DEFAULT_MAX_BODY_BYTES + 1;
    expect(() => validateContentLength(declaredLength, limit)).toThrow();
  });

 it("allows a body within the default limit for an undeclared route key", () => {
    const limit = resolveBodyLimit({ route: "undeclared-route", method: "POST" });
    expect(() => validateContentLength(DEFAULT_MAX_BODY_BYTES, limit)).not.toThrow();
  });
});

describe("readBodyWithLimit", () => {
  it("rejects a streamed body that exceeds the default limit for an undeclared route key", async () => {
    const limit = resolveBodyLimit({ route: "undeclared-route", method: "POST" });
    const chunk = new Uint8Array(DEFAULT_MAX_BODY_BYTES + 1);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    });

    await expect(readBodyWithLimit(stream, limit)).rejects.toThrow();
  });
});
