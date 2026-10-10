import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/server/api/errors";
import { handleMailboxSync } from "@/services/relay/mailbox-sync-transport";
import type { MailboxSyncService } from "@/services/relay/mailbox-sync-service";
import type { MailboxSyncResult } from "@/services/relay/mailbox-sync-types";

const actor = `G${"A".repeat(55)}`;

const okResult: MailboxSyncResult = {
  mode: "delta",
  events: [],
  cursor: "cursor-1",
  hasMore: false,
};

function stubService(
  behavior: (owner: string, input: unknown) => Promise<MailboxSyncResult> = async () => okResult,
): MailboxSyncService {
  return { sync: vi.fn(behavior) } as unknown as MailboxSyncService;
}

function syncRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://stealth.test/mailbox/sync", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-stealth-address": actor,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("handleMailboxSync", () => {
  it("passes a valid actor request to the service and returns 200", async () => {
    const service = stubService();

    const response = await handleMailboxSync(syncRequest({ deviceId: "device-1" }), service);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual(okResult);

    expect(service.sync).toHaveBeenCalledTimes(1);
    const [owner, input] = vi.mocked(service.sync).mock.calls[0] as [string, unknown];
    expect(owner).toBe(actor);
    expect(input).toMatchObject({ deviceId: "device-1" });
  });

  it("rejects a request with no actor before the service is called", async () => {
    const service = stubService();
    const request = new Request("https://stealth.test/mailbox/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId: "device-1" }),
    });

    const response = await handleMailboxSync(request, service);

    expect(response.status).toBe(401);
    expect(service.sync).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.error.code).toBe("unauthorized");
  });

  it("maps a service rejection to the error status and envelope", async () => {
    const service = stubService(async () => {
      throw new ApiError(503, "dependency_unavailable", "downstream mailbox store unavailable");
    });

    const response = await handleMailboxSync(syncRequest({ deviceId: "device-1" }), service);

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe("dependency_unavailable");
    expect(body.error.message).toBe("downstream mailbox store unavailable");
  });

  it("maps a conflict service error to 409 with retry classification", async () => {
    const service = stubService(async () => {
      throw new ApiError(409, "conflict", "Sync state changed");
    });

    const response = await handleMailboxSync(syncRequest({ deviceId: "device-1" }), service);

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatchObject({
      code: "conflict",
      message: "Sync state changed",
      retryable: true,
      retryClassification: "conflict",
    });
  });
});
