/**
 * React hook for resumable encrypted attachment upload (BETA-031 / #1938).
 *
 * Wraps the upload service with React state management for progress tracking,
 * status, and cancellation. Supports resume after interruption by querying
 * the upload session for previously committed chunks.
 */

import { useState, useCallback, useRef } from "react";
import {
  uploadAttachment,
  abortUpload,
  AttachmentUploadError,
  type UploadProgress,
  type UploadStatus,
  type UploadFileResult,
} from "@/services/attachment/upload";

export interface UseAttachmentUploadOptions {
  ownerAddress: string;
  messageId: string;
  chunkSizeBytes?: number;
  baseUrl?: string;
}

export interface UseAttachmentUploadReturn {
  upload: (file: File) => Promise<UploadFileResult>;
  cancel: () => void;
  status: UploadStatus;
  progress: UploadProgress | null;
  error: string | null;
  result: UploadFileResult | null;
  reset: () => void;
}

export function useAttachmentUpload(
  options: UseAttachmentUploadOptions,
): UseAttachmentUploadReturn {
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadFileResult | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
    if (sessionIdRef.current) {
      abortUpload(sessionIdRef.current, options.baseUrl).catch(() => undefined);
    }
    setError(null);
    setStatus("cancelled");
  }, [options.baseUrl]);

  const reset = useCallback(() => {
    setStatus("idle");
    setProgress(null);
    setError(null);
    setResult(null);
    sessionIdRef.current = null;
  }, []);

  const upload = useCallback(
    async (file: File): Promise<UploadFileResult> => {
      reset();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const uploadResult = await uploadAttachment({
          file,
          ownerAddress: options.ownerAddress,
          messageId: options.messageId,
          chunkSizeBytes: options.chunkSizeBytes,
          signal: controller.signal,
          baseUrl: options.baseUrl,
          onProgress: setProgress,
          onStatusChange: (nextStatus) => {
            if (!controller.signal.aborted) {
              setStatus(nextStatus);
            }
          },
          onSession: (sessionId) => {
            sessionIdRef.current = sessionId;
            if (controller.signal.aborted) {
              abortUpload(sessionId, options.baseUrl).catch(() => undefined);
            }
          },
        });

        sessionIdRef.current = uploadResult.sessionId;
        setResult(uploadResult);
        return uploadResult;
      } catch (err) {
        if (
          controller.signal.aborted ||
          (err instanceof AttachmentUploadError && err.code === "cancelled") ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          setError(null);
          setStatus("cancelled");
          throw err;
        }
        const message = err instanceof Error ? err.message : "Upload failed";
        setError(message);
        setStatus("error");
        throw err;
      }
    },
    [options.ownerAddress, options.messageId, options.chunkSizeBytes, options.baseUrl, reset],
  );

  return { upload, cancel, status, progress, error, result, reset };
}
