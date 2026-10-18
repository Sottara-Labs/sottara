/**
 * Durable mailbox sync cursors (Issue #1941 BETA-034).
 *
 * Cursors are versioned, HMAC-signed, and bound to the mailbox owner plus a
 * device id. They carry an explicit expiry so a stale reconnect recovers
 * through a bounded full resync rather than replaying unbounded history.
 *
 * This module is runtime-agnostic (Issue #317): it relies only on the Web
 * Crypto API (`crypto.subtle`), `Uint8Array`, `TextEncoder`, and
 * `TextDecoder` — never on `node:crypto` or the `Buffer` global — so it can be
 * imported from shared/browser graphs as well as the Workers runtime.
 */
import { ApiError } from "@/server/api/errors";
import { fromBase64, fromHex, toBase64, toHex } from "@/services/crypto/codec";
import { constantTimeEqual } from "@/services/crypto/constant-time";

import { SYNC_CURSOR_TTL_MS } from "./mailbox-sync-types";

const CURSOR_VERSION = 1;

interface MailboxCursorPayload {
  v: number;
  actor: string;
  deviceId: string;
  seq: number;
  iat: number;
  exp: number;
}

function cursorSecret(): string {
  if (typeof process === "undefined") return "";
  return process.env?.STEALTH_CURSOR_SECRET ?? "";
}

function toBytes(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(value));
}

/** HMAC-SHA256 over the UTF-8 payload using the Web Crypto API. */
async function hmacSha256(secret: string, payload: string): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey(
    "raw",
    toBytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, toBytes(payload));
  return new Uint8Array(signature);
}

async function sign(payload: string): Promise<string> {
  const secret = cursorSecret();
  if (!secret) {
    throw new ApiError(500, "internal_error", "Cursor signing secret is not configured");
  }
  return toHex(await hmacSha256(secret, payload));
}

function base64UrlEncode(value: string): string {
  return toBase64(toBytes(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): string {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return new TextDecoder().decode(fromBase64(base64));
}

export interface EncodedMailboxCursor {
  actor: string;
  deviceId: string;
  seq: number;
  issuedAt: number;
  expiresAt: number;
}

export async function encodeMailboxCursor(
  actor: string,
  deviceId: string,
  seq: number,
  nowMs: number = Date.now(),
  ttlMs: number = SYNC_CURSOR_TTL_MS,
): Promise<string> {
  if (!Number.isSafeInteger(seq) || seq < 0) {
    throw new ApiError(500, "internal_error", "Mailbox cursor seq is invalid");
  }
  const payload: MailboxCursorPayload = {
    v: CURSOR_VERSION,
    actor,
    deviceId,
    seq,
    iat: nowMs,
    exp: nowMs + ttlMs,
  };
  const raw = JSON.stringify(payload);
  return `${CURSOR_VERSION}.${await sign(raw)}.${base64UrlEncode(raw)}`;
}

export async function decodeMailboxCursor(
  cursor: string,
  actor: string,
  deviceId: string,
  nowMs: number = Date.now(),
): Promise<EncodedMailboxCursor> {
  const secret = cursorSecret();
  if (!secret) {
    throw new ApiError(500, "internal_error", "Cursor signing secret is not configured");
  }

  const parts = cursor.split(".");
  if (parts.length !== 3) {
    throw new ApiError(400, "bad_request", "Invalid mailbox sync cursor");
  }
  const [versionStr, signature, encoded] = parts;
  const version = Number(versionStr);
  if (!Number.isInteger(version) || version !== CURSOR_VERSION) {
    throw new ApiError(400, "bad_request", "Unsupported mailbox sync cursor version");
  }

  let raw: string;
  try {
    raw = base64UrlDecode(encoded);
  } catch {
    throw new ApiError(400, "bad_request", "Invalid mailbox sync cursor");
  }

  const expected = await hmacSha256(secret, raw);
  let provided: Uint8Array;
  try {
    provided = fromHex(signature);
  } catch {
    throw new ApiError(400, "bad_request", "Tampered mailbox sync cursor rejected");
  }
  if (!constantTimeEqual(provided, expected)) {
    throw new ApiError(400, "bad_request", "Tampered mailbox sync cursor rejected");
  }

  let payload: MailboxCursorPayload;
  try {
    payload = JSON.parse(raw) as MailboxCursorPayload;
  } catch {
    throw new ApiError(400, "bad_request", "Invalid mailbox sync cursor");
  }

  if (payload.v !== CURSOR_VERSION || !Number.isSafeInteger(payload.seq) || payload.seq < 0) {
    throw new ApiError(400, "bad_request", "Invalid mailbox sync cursor");
  }
  if (payload.actor !== actor) {
    throw new ApiError(403, "forbidden", "Mailbox sync cursor is bound to a different actor");
  }
  if (payload.deviceId !== deviceId) {
    throw new ApiError(400, "bad_request", "Mailbox sync cursor is bound to a different device");
  }
  if (payload.exp <= nowMs) {
    throw new ApiError(410, "cursor_expired", "Mailbox sync cursor has expired");
  }

  return {
    actor: payload.actor,
    deviceId: payload.deviceId,
    seq: payload.seq,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
  };
}
