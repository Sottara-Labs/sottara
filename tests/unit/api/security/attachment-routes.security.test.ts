/**
 * BETA-084 (Issue #1991) — Attachment download cross-account isolation.
 * Control owner: object-store / api-authorization.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { Route as DownloadRoute } from "@/routes/api/v1/attachments/download";
import { ACTOR_HEADER } from "@/server/api/actor";
import { assertNoSecretsLeaked } from "../../../fixtures/identity";
import {
  ALICE_ADDRESS,
  BOB_ADDRESS,
  MESSAGE_ID,
  aliceAttachmentContentHash,
  classifyDenial,
  seedAliceAttachmentObjectStore,
  seedTwoUserIsolationFixture,
} from "../../../fixtures/security-isolation";

describe("BETA-084 (Issue #1991): Attachment Download Isolation", () => {
  const downloadHandler = (
    DownloadRoute.options as {
      server?: { handlers?: { GET?: (ctx: { request: Request }) => Promise<Response> } };
    }
  ).server!.handlers!.GET!;

  beforeEach(async () => {
    const { repository } = await seedTwoUserIsolationFixture();
    await seedAliceAttachmentObjectStore(repository);
  });

  function downloadUrl(contentHash: string): string {
    return `https://stealth.test/api/v1/attachments/download?message_id=${MESSAGE_ID}&content_hash=${contentHash}&chunk_index=0`;
  }

  it("allows Alice to download her own attachment chunk (control path)", async () => {
    const res = await downloadHandler({
      request: new Request(downloadUrl(aliceAttachmentContentHash), {
        method: "GET",
        headers: { [ACTOR_HEADER]: ALICE_ADDRESS },
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-length")).toBe("4");
    expect(res.headers.get("x-chunk-index")).toBe("0");
    const buffer = await res.arrayBuffer();
    expect(Array.from(new Uint8Array(buffer))).toEqual([7, 8, 9, 10]);
  });

  it("denies Bob downloading Alice's attachment chunk", async () => {
    const res = await downloadHandler({
      request: new Request(downloadUrl(aliceAttachmentContentHash), {
        method: "GET",
        headers: { [ACTOR_HEADER]: BOB_ADDRESS },
      }),
    });
    expect(classifyDenial(res.status)).toBe("denied");
    assertNoSecretsLeaked(await res.text());
  });

  it("denies unauthenticated attachment download", async () => {
    const res = await downloadHandler({
      request: new Request(downloadUrl(aliceAttachmentContentHash), { method: "GET" }),
    });
    expect(res.status).toBe(401);
  });
});
