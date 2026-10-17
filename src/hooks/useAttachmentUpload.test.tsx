/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAttachmentUpload } from "./useAttachmentUpload";
import * as uploadService from "@/services/attachment/upload";
import type { UploadFileResult, UploadProgress } from "@/services/attachment/upload";

vi.mock("@/services/attachment/upload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/attachment/upload")>();
  return {
    ...actual,
    uploadAttachment: vi.fn(),
    abortUpload: vi.fn(),
  };
});

describe("useAttachmentUpload (#424)", () => {
  const defaultOptions = {
    ownerAddress: "GABC1234567890",
    messageId: "msg-001",
    chunkSizeBytes: 1024,
    baseUrl: "https://relay.example.test",
  };

  const mockFile = new File(["encrypted-payload"], "report.pdf", {
    type: "application/pdf",
  });

  const mockUploadResult: UploadFileResult = {
    sessionId: "sess-123",
    attachmentKey: {} as CryptoKey,
    manifest: {
      version: 1,
      algorithm: "AES-256-GCM",
      chunkSizeBytes: 1024,
      totalPlaintextBytes: 17,
      totalChunks: 1,
      plaintextHash: "deadbeef",
      chunks: [],
    } as any,
    contentHash: "deadbeef",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(uploadService.abortUpload).mockResolvedValue(undefined);
  });

  it("starts in idle state with null progress, error, and result", () => {
    const { result } = renderHook(() => useAttachmentUpload(defaultOptions));

    expect(result.current.status).toBe("idle");
    expect(result.current.progress).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.result).toBeNull();
  });

  it("drives the upload lifecycle through encrypting, uploading, finalizing, and done", async () => {
    const chunkProgress: UploadProgress = {
      attachmentIndex: 0,
      chunkIndex: 0,
      totalChunks: 2,
      uploadedChunks: 1,
      percent: 50,
    };
    const finalProgress: UploadProgress = {
      attachmentIndex: 0,
      chunkIndex: 1,
      totalChunks: 2,
      uploadedChunks: 2,
      percent: 100,
    };

    vi.mocked(uploadService.uploadAttachment).mockImplementation(async (params) => {
      params.onStatusChange?.("encrypting");
      params.onStatusChange?.("uploading");
      params.onProgress?.(chunkProgress);
      params.onProgress?.(finalProgress);
      params.onStatusChange?.("finalizing");
      params.onStatusChange?.("done");
      return mockUploadResult;
    });

    const { result } = renderHook(() => useAttachmentUpload(defaultOptions));

    let returned: UploadFileResult | undefined;
    await act(async () => {
      returned = await result.current.upload(mockFile);
    });

    expect(returned).toEqual(mockUploadResult);
    expect(result.current.status).toBe("done");
    expect(result.current.progress).toEqual(finalProgress);
    expect(result.current.result).toEqual(mockUploadResult);
    expect(result.current.error).toBeNull();

    expect(uploadService.uploadAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        file: mockFile,
        ownerAddress: defaultOptions.ownerAddress,
        messageId: defaultOptions.messageId,
        chunkSizeBytes: defaultOptions.chunkSizeBytes,
        baseUrl: defaultOptions.baseUrl,
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("handles AbortError by transitioning status to cancelled without setting error", async () => {
    const abortErr = new Error("Aborted by user");
    abortErr.name = "AbortError";

    vi.mocked(uploadService.uploadAttachment).mockRejectedValueOnce(abortErr);

    const { result } = renderHook(() => useAttachmentUpload(defaultOptions));

    await act(async () => {
      await expect(result.current.upload(mockFile)).rejects.toThrow("Aborted by user");
    });

    expect(result.current.status).toBe("cancelled");
    expect(result.current.error).toBeNull();
    expect(result.current.result).toBeNull();
  });

  it("transitions to error and records the message when upload fails", async () => {
    vi.mocked(uploadService.uploadAttachment).mockRejectedValueOnce(
      new Error("Chunk commit failed: HTTP 502"),
    );

    const { result } = renderHook(() => useAttachmentUpload(defaultOptions));

    await act(async () => {
      await expect(result.current.upload(mockFile)).rejects.toThrow(
        "Chunk commit failed: HTTP 502",
      );
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Chunk commit failed: HTTP 502");
    expect(result.current.result).toBeNull();
  });

  it("uses fallback message when a non-Error value is thrown", async () => {
    vi.mocked(uploadService.uploadAttachment).mockRejectedValueOnce("unexpected string rejection");

    const { result } = renderHook(() => useAttachmentUpload(defaultOptions));

    await act(async () => {
      await expect(result.current.upload(mockFile)).rejects.toBe("unexpected string rejection");
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Upload failed");
  });

  it("aborts the active controller and notifies abortUpload when cancel() is called after a session exists", async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(uploadService.uploadAttachment).mockImplementationOnce(async (params) => {
      capturedSignal = params.signal;
      return mockUploadResult;
    });

    const { result } = renderHook(() => useAttachmentUpload(defaultOptions));

    await act(async () => {
      await result.current.upload(mockFile);
    });

    act(() => {
      result.current.cancel();
    });

    expect(capturedSignal?.aborted).toBe(true);
    expect(result.current.status).toBe("cancelled");
    expect(uploadService.abortUpload).toHaveBeenCalledWith("sess-123", defaultOptions.baseUrl);
  });

  it("resets status, progress, error, and result back to idle", async () => {
    vi.mocked(uploadService.uploadAttachment).mockRejectedValueOnce(new Error("Temporary failure"));

    const { result } = renderHook(() => useAttachmentUpload(defaultOptions));

    await act(async () => {
      await expect(result.current.upload(mockFile)).rejects.toThrow("Temporary failure");
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Temporary failure");

    act(() => {
      result.current.reset();
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.progress).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.result).toBeNull();
  });
});
