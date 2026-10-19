import { beforeEach, describe, expect, it, vi } from "vitest";

import { Route as DownloadRoute } from "@/routes/api/v1/attachments/download";
import { downloadAttachment } from "@/services/attachment/download";
import { ACTOR_HEADER } from "@/server/api/actor";
import { FakeR2Bucket } from "@/services/storage/r2-fake";
import { R2ObjectStoreAdapter } from "@/services/storage/r2-adapter";
import {
  attachmentChunkKey,
  createObjectCommitment,
} from "@/services/storage/object-store";
import {
  encryptAttachmentStream,
  type AttachmentStreamManifest,
} from "@/services/crypto/attachment-stream";
import {
  ALICE_ADDRESS,
  MESSAGE_ID,
  seedTwoUserIsolationFixture,
} from "../../fixtures/security-isolation";

describe("BETA-031 / Issue #510: Binary Attachment Chunk Download Wire Contract", () => {
  const downloadHandler = (
    DownloadRoute.options as {
      server?: { handlers?: { GET?: (ctx: { request: Request }) => Promise<Response> } };
    }
  ).server!.handlers!.GET!;

  let objectStore: R2ObjectStoreAdapter;

  beforeEach(async () => {
    const { repository } = await seedTwoUserIsolationFixture();
    (globalThis as { __stealthApiRepository?: unknown }).__stealthApiRepository = repository;

    const bucket = new FakeR2Bucket();
    objectStore = new R2ObjectStoreAdapter(bucket as unknown as R2Bucket);
    (globalThis as { __stealthObjectStore?: R2ObjectStoreAdapter }).__stealthObjectStore =
      objectStore;
  });

  it("returns exactly 1 MB binary body with Content-Length and metadata headers for a 1 MB chunk", async () => {
    // 1 MB binary payload
    const oneMbBytes = new Uint8Array(1024 * 1024);
    for (let i = 0; i < oneMbBytes.length; i++) {
      oneMbBytes[i] = i % 256;
    }

    const commitment = await createObjectCommitment(oneMbBytes);
    const contentHash = commitment.split(":")[3]!;
    const key = attachmentChunkKey(MESSAGE_ID, commitment, 0);

    const staged = await objectStore.stage({
      kind: "attachment-chunk",
      messageId: MESSAGE_ID,
      ownerAddress: ALICE_ADDRESS,
      contentType: "application/pdf",
      contentLength: oneMbBytes.length,
      contentCommitment: commitment,
      bytes: oneMbBytes,
      chunkIndex: 0,
      totalChunks: 1,
    });

    await objectStore.finalize({
      stagedKey: staged.stagedKey,
      ownerAddress: ALICE_ADDRESS,
      expectedContentLength: oneMbBytes.length,
      expectedCommitment: commitment,
    });

    const url = `https://stealth.test/api/v1/attachments/download?message_id=${MESSAGE_ID}&content_hash=${contentHash}&chunk_index=0`;
    const res = await downloadHandler({
      request: new Request(url, {
        method: "GET",
        headers: { [ACTOR_HEADER]: ALICE_ADDRESS },
      }),
    });

    // Acceptance criteria:
    // 1. A 1 MB chunk response body is exactly 1 MB (not a JSON number array).
    // 2. Content-Type is application/octet-stream.
    // 3. Content-Length is 1048576.
    // 4. x-content-type and x-chunk-index metadata headers are populated.
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-length")).toBe(String(1024 * 1024));
    expect(res.headers.get("x-content-type")).toBe("application/pdf");
    expect(res.headers.get("x-chunk-index")).toBe("0");

    const arrayBuffer = await res.arrayBuffer();
    expect(arrayBuffer.byteLength).toBe(1024 * 1024);
    const receivedBytes = new Uint8Array(arrayBuffer);
    expect(receivedBytes[0]).toBe(0);
    expect(receivedBytes[1]).toBe(1);
    expect(receivedBytes[1024 * 1024 - 1]).toBe((1024 * 1024 - 1) % 256);
  });

  it("preserves JSON error envelope on error paths (e.g. 404 not found)", async () => {
    const nonExistentHash = "0".repeat(64);
    const url = `https://stealth.test/api/v1/attachments/download?message_id=${MESSAGE_ID}&content_hash=${nonExistentHash}&chunk_index=0`;
    const res = await downloadHandler({
      request: new Request(url, {
        method: "GET",
        headers: { [ACTOR_HEADER]: ALICE_ADDRESS },
      }),
    });

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    const json = await res.json();
    expect(json.error).toBeDefined();
    expect(json.error.code).toBe("not_found");
  });

  it("downloadAttachment client consumes binary arrayBuffer and reconstructs plaintext", async () => {
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );

    const originalData = new TextEncoder().encode("Hello, this is binary attachment test data!");
    async function* sourceStream() {
      yield originalData;
    }

    const { manifest: manifestPromise, chunks } = encryptAttachmentStream(key, sourceStream(), {
      chunkSizeBytes: 1024,
    });

    const frames = [];
    for await (const frame of chunks) {
      frames.push(frame);
    }
    const manifest = await manifestPromise;
    expect(frames.length).toBe(1);

    // Frame wire format: nonce (12B) || ciphertext || mac (16B)
    const frame = frames[0]!;
    const nonceBytes = new Uint8Array(12);
    for (let i = 0; i < 12; i++) {
      nonceBytes[i] = Number.parseInt(frame.nonce.slice(i * 2, i * 2 + 2), 16);
    }
    const macBytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      macBytes[i] = Number.parseInt(frame.mac.slice(i * 2, i * 2 + 2), 16);
    }
    const cipherBinary = atob(frame.ciphertext);
    const cipherBytes = new Uint8Array(cipherBinary.length);
    for (let i = 0; i < cipherBinary.length; i++) {
      cipherBytes[i] = cipherBinary.charCodeAt(i);
    }

    const wireChunk = new Uint8Array(nonceBytes.length + cipherBytes.length + macBytes.length);
    wireChunk.set(nonceBytes, 0);
    wireChunk.set(cipherBytes, nonceBytes.length);
    wireChunk.set(macBytes, nonceBytes.length + cipherBytes.length);

    // Mock global fetch for downloadAttachment
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/download?")) {
        return new Response(wireChunk, {
          status: 200,
          headers: {
            "content-type": "application/octet-stream",
            "content-length": String(wireChunk.byteLength),
            "x-content-type": "text/plain",
            "x-chunk-index": "0",
          },
        });
      }
      return originalFetch(url);
    }) as any;

    try {
      const result = await downloadAttachment({
        messageId: MESSAGE_ID,
        contentHash: "hash-unused-in-mock",
        totalChunks: 1,
        encryptionKey: key,
        manifest,
        ownerAddress: ALICE_ADDRESS,
      });

      expect(result.chunks).toBe(1);
      const text = await result.blob.text();
      expect(text).toBe("Hello, this is binary attachment test data!");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
