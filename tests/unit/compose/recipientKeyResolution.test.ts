// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchKeyDirectory } from "@/features/compose/recipientKeyResolution";

const owner = `g${"a".repeat(55)}`;
const directory = {
  owner: owner.toUpperCase(),
  currentKeys: {},
  historicalKeys: [],
  allKeys: [],
  version: 1,
  updatedAt: "2026-01-01T00:00:00.000Z",
  freshness: {
    resolvedAt: "2026-01-01T00:00:00.000Z",
    cached: false,
    ttlMs: 60_000,
  },
};

describe("fetchKeyDirectory", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes the owner and returns the directory payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: directory }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchKeyDirectory(`  ${owner}  `)).resolves.toEqual(directory);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/identity/keys/?owner=${owner.toUpperCase()}`,
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
  });

  it("maps a missing directory response to null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    await expect(fetchKeyDirectory(owner)).resolves.toBeNull();
  });

  it("maps network failures to unavailable without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));

    await expect(fetchKeyDirectory(owner)).resolves.toBeNull();
  });

  it("propagates aborts instead of returning a stale or cached value", async () => {
    const abortError = new DOMException("request aborted", "AbortError");
    const fetchMock = vi.fn().mockRejectedValue(abortError);
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();

    await expect(fetchKeyDirectory(owner, controller.signal)).rejects.toBe(abortError);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/identity/keys/?owner=${owner.toUpperCase()}`,
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
