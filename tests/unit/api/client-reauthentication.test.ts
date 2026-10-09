import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClient, ApiClientError } from "@/lib/api";

describe("ApiClient reauthentication", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([401, 403])("invokes the hook once and still rejects for HTTP %i", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status }));
    vi.stubGlobal("fetch", fetchMock);
    const onUnauthorized = vi.fn();
    const client = new ApiClient({ onUnauthorized, isOnline: () => true });

    await expect(client.get("/mailbox/sync")).rejects.toMatchObject({
      name: "ApiClientError",
      status,
    });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403])("preserves the HTTP %i error when no hook is configured", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
    const client = new ApiClient({ isOnline: () => true });

    await expect(client.get("/mailbox/sync")).rejects.toBeInstanceOf(ApiClientError);
  });

  it.each([404, 429, 500])("does not invoke the hook for HTTP %i", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
    const onUnauthorized = vi.fn();
    const client = new ApiClient({ onUnauthorized, isOnline: () => true });

    await expect(client.get("/mailbox/sync")).rejects.toMatchObject({ status });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("returns successful data without invoking the hook", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: { messages: [] } })));
    const onUnauthorized = vi.fn();
    const client = new ApiClient({ onUnauthorized, isOnline: () => true });

    await expect(client.get("/mailbox/sync")).resolves.toEqual({ messages: [] });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
