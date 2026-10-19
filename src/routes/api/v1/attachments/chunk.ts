import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { getApiContext, getObjectStore } from "@/server/api/context";
import { parseJsonBody } from "@/server/api/request";
import { apiSuccess, handleApiRequest } from "@/server/api/response";
import { ApiError } from "@/server/api/errors";
import { enforceCapability } from "@/server/api/beta-controls/guard";
import {
  uploadChunk,
  getUploadSession,
  type UploadSessionError,
} from "@/services/attachment/upload-session";
import {
  attachmentChunkKey,
  createObjectCommitment,
  OBJECT_KIND_ATTACHMENT_CHUNK,
} from "@/services/storage/object-store";

const uploadChunkSchema = z.object({
  session_id: z.string().trim().min(1).max(128),
  attachment_index: z.number().int().nonnegative(),
  chunk_index: z.number().int().nonnegative(),
  nonce: z.string().min(1, "nonce is required"),
  ciphertext: z.string().min(1, "ciphertext is required"),
  mac: z.string().min(1, "mac is required"),
  final: z.boolean(),
});

export const NONCE_BYTES = 12;
export const MAC_BYTES = 16;
export const MAX_CHUNK_SIZE_BYTES = 1 * 1024 * 1024; // 1 MiB (matches DEFAULT_CHUNK_SIZE_BYTES and fit within 2 MiB relay limit)
export const MAX_FRAME_SIZE_BYTES = NONCE_BYTES + MAX_CHUNK_SIZE_BYTES + MAC_BYTES;

const STRICT_BASE64_REGEX =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$/;

export function validateHexBytes(
  hex: string,
  expectedBytes: number,
  fieldName: string,
): Uint8Array {
  if (
    typeof hex !== "string" ||
    hex.length !== expectedBytes * 2 ||
    !/^[0-9a-fA-F]+$/.test(hex)
  ) {
    throw new ApiError(
      400,
      "bad_request",
      `Invalid ${fieldName}: must be exactly ${expectedBytes} bytes of valid hexadecimal (${expectedBytes * 2} characters)`,
    );
  }
  const out = new Uint8Array(expectedBytes);
  for (let i = 0; i < expectedBytes; i++) {
    const val = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(val)) {
      throw new ApiError(
        400,
        "bad_request",
        `Invalid ${fieldName}: contains non-hexadecimal character`,
      );
    }
    out[i] = val;
  }
  return out;
}

export function validateAndDecodeStrictBase64(
  b64: string,
  fieldName: string,
  maxBytes: number = MAX_CHUNK_SIZE_BYTES,
): Uint8Array {
  if (
    typeof b64 !== "string" ||
    b64.length === 0 ||
    b64.length % 4 !== 0 ||
    !STRICT_BASE64_REGEX.test(b64)
  ) {
    throw new ApiError(
      400,
      "bad_request",
      `Invalid ${fieldName}: must be valid strict base64 encoding without stray characters or malformed padding`,
    );
  }

  let padding = 0;
  if (b64.endsWith("==")) padding = 2;
  else if (b64.endsWith("=")) padding = 1;
  const decodedLength = (b64.length / 4) * 3 - padding;

  if (decodedLength > maxBytes) {
    throw new ApiError(
      400,
      "bad_request",
      `Attachment chunk ciphertext exceeds maximum size of ${maxBytes} bytes`,
    );
  }

  let binary: string;
  try {
    binary = atob(b64);
  } catch {
    throw new ApiError(
      400,
      "bad_request",
      `Invalid ${fieldName}: base64 decoding failed`,
    );
  }

  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export const Route = createFileRoute("/api/v1/attachments/chunk")({
  server: {
    handlers: {
      POST: ({ request }) =>
        handleApiRequest(request, async () => {
          const ctx = await getApiContext(request);
          if (!ctx.isAuthenticated) {
            throw new ApiError(401, "unauthorized", "Authentication is required");
          }

          // BETA-095: operator kill switch for attachments. Fails closed. A
          // session obtained before the switch closed must not keep streaming
          // (or finalizing) data, so the gate is enforced on every upload step.
          await enforceCapability("attachments");

          const input = await parseJsonBody(request, uploadChunkSchema, "relay");
          const ip =
            request.headers.get("cf-connecting-ip") ??
            request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
            "unknown";

          // Enforce framing validation and bounds before touching upload sessions or storage
          // 1. Validate nonce (exactly 12 bytes hex)
          const nonceBytes = validateHexBytes(input.nonce, NONCE_BYTES, "nonce");

          // 2. Validate MAC (exactly 16 bytes hex)
          const macBytes = validateHexBytes(input.mac, MAC_BYTES, "mac");

          // 3. Validate maximum frame size before decoding
          let padding = 0;
          if (input.ciphertext.endsWith("==")) padding = 2;
          else if (input.ciphertext.endsWith("=")) padding = 1;
          const estimatedCiphertextBytes =
            input.ciphertext.length % 4 === 0
              ? (input.ciphertext.length / 4) * 3 - padding
              : Math.ceil((input.ciphertext.length * 3) / 4);
          const estimatedFrameSize = NONCE_BYTES + estimatedCiphertextBytes + MAC_BYTES;
          if (estimatedFrameSize > MAX_FRAME_SIZE_BYTES) {
            throw new ApiError(
              400,
              "bad_request",
              `Attachment chunk frame size (${estimatedFrameSize} bytes) exceeds maximum limit of ${MAX_FRAME_SIZE_BYTES} bytes`,
            );
          }

          // 4. Validate ciphertext (strict base64) and decode
          const ciphertextBytes = validateAndDecodeStrictBase64(
            input.ciphertext,
            "ciphertext",
            MAX_CHUNK_SIZE_BYTES,
          );

          const chunkBytes = new Uint8Array(
            nonceBytes.length + ciphertextBytes.length + macBytes.length,
          );
          chunkBytes.set(nonceBytes, 0);
          chunkBytes.set(ciphertextBytes, nonceBytes.length);
          chunkBytes.set(macBytes, nonceBytes.length + ciphertextBytes.length);

          // Verify no NaN byte exists in the concatenated frame
          for (let i = 0; i < chunkBytes.length; i++) {
            if (Number.isNaN(chunkBytes[i])) {
              throw new ApiError(
                400,
                "bad_request",
                "Malformed frame: contains invalid byte representation",
              );
            }
          }

          const { enforceCentralAbuse } = await import("@/server/api/abuse-service");
          const decision = await enforceCentralAbuse(ctx.repository, {
            route: "attachment_upload",
            ip,
            account: ctx.principal.address,
            session: input.session_id,
            storageBytes: chunkBytes.length,
            headers: request.headers,
          });

          if (!decision.allowed) {
            throw new ApiError(
              429,
              "too_many_requests",
              decision.reason === "storage_byte_budget_exceeded"
                ? "Attachment chunk storage byte budget exceeded"
                : "Attachment rate limit exceeded",
              { retryAfterSeconds: decision.retryAfterSeconds ?? 3600 },
            );
          }

          try {
            const result = await uploadChunk({
              sessionId: input.session_id,
              ownerAddress: ctx.principal.address,
              attachmentIndex: input.attachment_index,
              chunkIndex: input.chunk_index,
              chunkBytes: ciphertextBytes,
            });

            const session = getUploadSession(input.session_id);
            if (session) {
              const attachment = session.attachments[input.attachment_index];
              if (attachment) {
                const objectStore = await getObjectStore();
                if (objectStore) {
                  const contentCommitment = await createObjectCommitment(chunkBytes);
                  const key = attachmentChunkKey(
                    session.messageId,
                    contentCommitment,
                    input.chunk_index,
                  );

                  try {
                    const { stagedKey } = await objectStore.stage({
                      kind: OBJECT_KIND_ATTACHMENT_CHUNK,
                      messageId: session.messageId,
                      ownerAddress: ctx.principal.address,
                      contentType: "application/octet-stream",
                      contentLength: chunkBytes.length,
                      contentCommitment,
                      bytes: chunkBytes,
                      chunkIndex: input.chunk_index,
                      totalChunks: attachment.totalChunks,
                    });

                    await objectStore.finalize({
                      stagedKey,
                      ownerAddress: ctx.principal.address,
                      expectedContentLength: chunkBytes.length,
                      expectedCommitment: contentCommitment,
                    });
                  } catch {
                    // Object store may not be available in dev/test; session tracking still works
                  }
                }
              }
            }

            return apiSuccess(request, result);
          } catch (error) {
            if (error && typeof error === "object" && "code" in error && "status" in error) {
              const sessionError = error as UploadSessionError;
              throw new ApiError(
                sessionError.status,
                sessionError.code as any,
                sessionError.message,
              );
            }
            throw error;
          }
        }),
    },
  },
});
