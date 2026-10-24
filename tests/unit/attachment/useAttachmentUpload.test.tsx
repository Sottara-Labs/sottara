// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAttachmentUpload } from "@/hooks/useAttachmentUpload";
import { AttachmentUploadError } from "@/services/attachment/upload";
import { MIN_CHUNK_SIZE_BYTES } from "@/services/crypto/attachment-stream";

const OWNER = "GA7QNF7GTH7QNF7GTH7QNF7GTH7QNF7GTH7QNF7GTH7QNF7GTH7QNF7G";
const MESSAGE_ID = "b".repeat(64);

function makeTestFile(sizeBytes = 2048): File {
  const bytes = new Uint8Array(sizeBytes);
  bytes.fill(7);
  return new File([bytes], "report.pdf", { type: "application/pdf" });
}

function abortableFetchPromise(signal?: AbortSignal): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const onAbort = () => {
      const abortErr = new Error("The operation was aborted.");
      abortErr.name = "AbortError";
      reject(abortErr);
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useAttachmentUpload cancellation (#502)", () => {
  it("surfaces status 'cancelled' with error null when cancelled before /initiate resolves", async () => {
    let initiateCalled = false;
    const fetchMock = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith("/initiate")) {
        initiateCalled = true;
        return abortableFetchPromise(init?.signal ?? undefined);
      }
      throw new Error(`Unexpected fetch URL: ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useAttachmentUpload({
        ownerAddress: OWNER,
        messageId: MESSAGE_ID,
        chunkSizeBytes: MIN_CHUNK_SIZE_BYTES,
      }),
    );

    let uploadPromise!: Promise<unknown>;
    await act(async () => {
      uploadPromise = result.current.upload(makeTestFile());
      for (let i = 0; i < 20 && !initiateCalled; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      result.current.cancel();
      await expect(uploadPromise).rejects.toBeInstanceOf(AttachmentUploadError);
    });

    expect(result.current.status).toBe("cancelled");
    expect(result.current.error).toBeNull();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith("/abort")),
    ).toBe(false);
  });

  it("calls /abort with the active sessionId and keeps status 'cancelled' and error null when cancelled mid-upload", async () => {
    let chunkStarted = false;
    const abortCalls: Array<{ url: string; body: unknown }> = [];

    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith("/initiate")) {
        return new Response(
          JSON.stringify({
            data: {
              sessionId: "sess-active-502",
              attachments: [
                {
                  attachmentIndex: 0,
                  totalChunks: 1,
                  uploadedChunks: [],
                },
              ],
              expiresAt: "2026-12-31T00:00:00.000Z",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (target.endsWith("/chunk")) {
        chunkStarted = true;
        return abortableFetchPromise(init?.signal ?? undefined);
      }
      if (target.endsWith("/abort")) {
        abortCalls.push({
          url: target,
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return new Response(JSON.stringify({ aborted: true }), { status: 200 });
      }
      throw new Error(`Unexpected fetch URL: ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useAttachmentUpload({
        ownerAddress: OWNER,
        messageId: MESSAGE_ID,
        chunkSizeBytes: MIN_CHUNK_SIZE_BYTES,
      }),
    );

    let uploadPromise!: Promise<unknown>;
    await act(async () => {
      uploadPromise = result.current.upload(makeTestFile());
      for (let i = 0; i < 40 && !chunkStarted; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      result.current.cancel();
      await expect(uploadPromise).rejects.toBeInstanceOf(AttachmentUploadError);
    });

    expect(chunkStarted).toBe(true);
    expect(result.current.status).toBe("cancelled");
    expect(result.current.error).toBeNull();
    expect(abortCalls).toEqual([
      {
        url: "/api/v1/attachments/abort",
        body: { session_id: "sess-active-502" },
      },
    ]);
  });
});
