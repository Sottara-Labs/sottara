import { describe, expect, it, vi } from "vitest";

import { ACTOR_HEADER } from "../../../src/server/api/actor";
import { ApiError } from "../../../src/server/api/errors";
import { handleMailboxSync } from "../../../src/services/relay/mailbox-sync-transport";
import type { MailboxSyncResult } from "../../../src/services/relay/mailbox-sync-types";
import type { MailboxSyncService } from "../../../src/services/relay/mailbox-sync-service";

const actor = `G${"A".repeat(55)}`;

const syncResult: MailboxSyncResult = {
  mode: "delta",
  events: [],
  cursor: "cursor-v1",
  hasMore: false,
};

function request(body: unknown, authenticatedActor?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (authenticatedActor !== undefined) headers.set(ACTOR_HEADER, authenticatedActor);
  return new Request("https://stealth.test/api/v1/mailbox/sync", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function serviceStub() {
  return {
    sync: vi.fn().mockResolvedValue(syncResult),
  } as unknown as MailboxSyncService & { sync: ReturnType<typeof vi.fn> };
}

describe("handleMailboxSync transport", () => {
  it("forwards the authenticated actor and validated sync input", async () => {
    const service = serviceStub();
    const body = { deviceId: "device-one", limit: 25 };

    const response = await handleMailboxSync(request(body, actor), service);

    expect(response.status).toBe(200);
    expect(service.sync).toHaveBeenCalledOnce();
    expect(service.sync).toHaveBeenCalledWith(actor, body);
    await expect(response.json()).resolves.toMatchObject({ data: syncResult });
  });

  it("rejects a request without an authenticated actor before calling the service", async () => {
    const service = serviceStub();

    const response = await handleMailboxSync(request({ deviceId: "device-one" }), service);

    expect(response.status).toBe(401);
    expect(service.sync).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unauthorized" },
    });
  });

  it("maps a service error to the documented API error envelope", async () => {
    const service = serviceStub();
    service.sync.mockRejectedValueOnce(new ApiError(409, "conflict", "Sync state changed"));

    const response = await handleMailboxSync(request({ deviceId: "device-one" }, actor), service);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "conflict",
        message: "Sync state changed",
        retryable: true,
        retryClassification: "conflict",
      },
    });
  });
});
