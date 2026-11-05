import { beforeEach, describe, expect, it } from "vitest";

import {
  Route as ChunkRoute,
  validateHexBytes,
  validateAndDecodeStrictBase64,
  NONCE_BYTES,
  MAC_BYTES,
  MAX_CHUNK_SIZE_BYTES,
  MAX_FRAME_SIZE_BYTES,
} from "@/routes/api/v1/attachments/chunk";
import {
  initiateUploadSession,
  getUploadSession,
} from "@/services/attachment/upload-session";
import { ACTOR_HEADER } from "@/server/api/actor";
import {
  ALICE_ADDRESS,
  MESSAGE_ID,
  CONTENT_HASH,
  seedTwoUserIsolationFixture,
} from "../../fixtures/security-isolation";

describe("BETA-031 / Issue #511: Attachment chunk framing validation", () => {
  const chunkHandler = (
    ChunkRoute.options as {
      server?: { handlers?: { POST?: (ctx: { request: Request }) => Promise<Response> } };
    }
  ).server!.handlers!.POST!;

  describe("validateHexBytes unit tests", () => {
    it("accepts valid 12-byte hex nonce without NaN bytes", () => {
      const validNonceHex = "000102030405060708090a0b";
      const bytes = validateHexBytes(validNonceHex, NONCE_BYTES, "nonce");
      expect(bytes).toHaveLength(12);
      expect(Array.from(bytes).some(Number.isNaN)).toBe(false);
      expect(bytes[0]).toBe(0x00);
      expect(bytes[11]).toBe(0x0b);
    });

    it("accepts valid 16-byte hex MAC without NaN bytes", () => {
      const validMacHex = "00112233445566778899aabbccddeeff";
      const bytes = validateHexBytes(validMacHex, MAC_BYTES, "mac");
      expect(bytes).toHaveLength(16);
      expect(Array.from(bytes).some(Number.isNaN)).toBe(false);
      expect(bytes[0]).toBe(0x00);
      expect(bytes[15]).toBe(0xff);
    });

    it("rejects odd-length hex", () => {
      expect(() => validateHexBytes("00112233445566778899aab", NONCE_BYTES, "nonce")).toThrow(
        /must be exactly 12 bytes of valid hexadecimal/i,
      );
    });

    it("rejects non-hex characters", () => {
      expect(() => validateHexBytes("000102030405060708090azz", NONCE_BYTES, "nonce")).toThrow(
        /must be exactly 12 bytes of valid hexadecimal/i,
      );
      expect(() => validateHexBytes("000102030405060708090a-b", NONCE_BYTES, "nonce")).toThrow(
        /must be exactly 12 bytes of valid hexadecimal/i,
      );
    });

    it("rejects hex of wrong byte length (too short or too long)", () => {
      // 11 bytes (22 chars)
      expect(() => validateHexBytes("000102030405060708090a", NONCE_BYTES, "nonce")).toThrow(
        /must be exactly 12 bytes/i,
      );
      // 13 bytes (26 chars)
      expect(() => validateHexBytes("000102030405060708090a0b0c", NONCE_BYTES, "nonce")).toThrow(
        /must be exactly 12 bytes/i,
      );
    });
  });

  describe("validateAndDecodeStrictBase64 unit tests", () => {
    it("decodes valid strict base64 payloads with various padding formats", () => {
      // Multiple of 3 bytes -> no padding: "ABCD" -> [0, 16, 131]
      const b64NoPad = btoa("hello world");
      const bytesNoPad = validateAndDecodeStrictBase64(b64NoPad, "ciphertext");
      expect(new TextDecoder().decode(bytesNoPad)).toBe("hello world");

      // 1 padding char:
      const b64Pad1 = btoa("hello worl");
      const bytesPad1 = validateAndDecodeStrictBase64(b64Pad1, "ciphertext");
      expect(new TextDecoder().decode(bytesPad1)).toBe("hello worl");

      // 2 padding chars:
      const b64Pad2 = btoa("hello wor");
      const bytesPad2 = validateAndDecodeStrictBase64(b64Pad2, "ciphertext");
      expect(new TextDecoder().decode(bytesPad2)).toBe("hello wor");
    });

    it("rejects non-base64 characters and url-safe base64 characters", () => {
      expect(() => validateAndDecodeStrictBase64("abc-defg", "ciphertext")).toThrow(
        /must be valid strict base64/i,
      );
      expect(() => validateAndDecodeStrictBase64("abc_defg", "ciphertext")).toThrow(
        /must be valid strict base64/i,
      );
      expect(() => validateAndDecodeStrictBase64("abc!defg", "ciphertext")).toThrow(
        /must be valid strict base64/i,
      );
    });

    it("rejects invalid padding and bad lengths", () => {
      // Not multiple of 4
      expect(() => validateAndDecodeStrictBase64("abc", "ciphertext")).toThrow(
        /must be valid strict base64/i,
      );
      expect(() => validateAndDecodeStrictBase64("abcde", "ciphertext")).toThrow(
        /must be valid strict base64/i,
      );
      // Padding in middle
      expect(() => validateAndDecodeStrictBase64("ab=cdefg", "ciphertext")).toThrow(
        /must be valid strict base64/i,
      );
      // Excessive padding
      expect(() => validateAndDecodeStrictBase64("a===", "ciphertext")).toThrow(
        /must be valid strict base64/i,
      );
    });

    it("rejects ciphertext exceeding maximum byte limit", () => {
      const smallLimit = 10;
      const b64Oversized = btoa("this string has more than ten bytes");
      expect(() =>
        validateAndDecodeStrictBase64(b64Oversized, "ciphertext", smallLimit),
      ).toThrow(/exceeds maximum size of 10 bytes/i);
    });
  });

  describe("API Route POST /api/v1/attachments/chunk", () => {
    let sessionId: string;

    beforeEach(async () => {
      await seedTwoUserIsolationFixture();

      const session = initiateUploadSession({
        ownerAddress: ALICE_ADDRESS,
        messageId: MESSAGE_ID,
        attachments: [
          {
            filename: "document.pdf",
            content_type: "application/pdf",
            size_bytes: 2048,
            content_hash: CONTENT_HASH,
            total_chunks: 2,
          },
        ],
      });
      sessionId = session.session_id;
    });

    function createChunkRequest(payload: Record<string, unknown>): Request {
      return new Request("https://stealth.test/api/v1/attachments/chunk", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [ACTOR_HEADER]: ALICE_ADDRESS,
        },
        body: JSON.stringify(payload),
      });
    }

    it("accepts valid chunk frame and records it in session", async () => {
      const validPayload = {
        session_id: sessionId,
        attachment_index: 0,
        chunk_index: 0,
        nonce: "000102030405060708090a0b",
        ciphertext: btoa("chunk-0-ciphertext-bytes"),
        mac: "00112233445566778899aabbccddeeff",
        final: false,
      };

      const res = await chunkHandler({ request: createChunkRequest(validPayload) });
      expect(res.status).toBe(200);

      const session = getUploadSession(sessionId);
      expect(session?.attachments[0].uploadedChunks.has(0)).toBe(true);
    });

    it("rejects malformed nonce with 400 and leaves session unchanged", async () => {
      const invalidNoncePayload = {
        session_id: sessionId,
        attachment_index: 0,
        chunk_index: 0,
        nonce: "invalid-odd-hex", // odd length & non-hex
        ciphertext: btoa("chunk-0-ciphertext-bytes"),
        mac: "00112233445566778899aabbccddeeff",
        final: false,
      };

      const res = await chunkHandler({ request: createChunkRequest(invalidNoncePayload) });
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error.code).toBe("bad_request");
      expect(body.error.message).toMatch(/Invalid nonce/i);

      // Session must remain unchanged
      const session = getUploadSession(sessionId);
      expect(session?.attachments[0].uploadedChunks.has(0)).toBe(false);
    });

    it("rejects malformed MAC with 400 and leaves session unchanged", async () => {
      const invalidMacPayload = {
        session_id: sessionId,
        attachment_index: 0,
        chunk_index: 0,
        nonce: "000102030405060708090a0b",
        ciphertext: btoa("chunk-0-ciphertext-bytes"),
        mac: "1234567890abcdefZZ", // non-hex & wrong length
        final: false,
      };

      const res = await chunkHandler({ request: createChunkRequest(invalidMacPayload) });
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error.code).toBe("bad_request");
      expect(body.error.message).toMatch(/Invalid mac/i);

      // Session must remain unchanged
      const session = getUploadSession(sessionId);
      expect(session?.attachments[0].uploadedChunks.has(0)).toBe(false);
    });

    it("rejects malformed ciphertext base64 with 400 and leaves session unchanged", async () => {
      const invalidCiphertextPayload = {
        session_id: sessionId,
        attachment_index: 0,
        chunk_index: 0,
        nonce: "000102030405060708090a0b",
        ciphertext: "not-valid-base64-stray!*@",
        mac: "00112233445566778899aabbccddeeff",
        final: false,
      };

      const res = await chunkHandler({ request: createChunkRequest(invalidCiphertextPayload) });
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error.code).toBe("bad_request");
      expect(body.error.message).toMatch(/Invalid ciphertext/i);

      // Session must remain unchanged
      const session = getUploadSession(sessionId);
      expect(session?.attachments[0].uploadedChunks.has(0)).toBe(false);
    });

    it("rejects frame exceeding maximum frame size limit and leaves session unchanged", async () => {
      // Base64 string of ~1.6MB which decodes to ~1.2MB, exceeding MAX_FRAME_SIZE_BYTES (1MiB + 28 bytes)
      // while safely fitting within the 2MB relay request body limit.
      const oversizedCiphertext = "AAAA".repeat(400 * 1024);
      const oversizedPayload = {
        session_id: sessionId,
        attachment_index: 0,
        chunk_index: 0,
        nonce: "000102030405060708090a0b",
        ciphertext: oversizedCiphertext,
        mac: "00112233445566778899aabbccddeeff",
        final: false,
      };

      const res = await chunkHandler({ request: createChunkRequest(oversizedPayload) });
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error.code).toBe("bad_request");
      expect(body.error.message).toMatch(/exceeds maximum limit/i);

      // Session must remain unchanged
      const session = getUploadSession(sessionId);
      expect(session?.attachments[0].uploadedChunks.has(0)).toBe(false);
    });

    it("ensures no NaN byte can enter the stored frame", async () => {
      const validPayload = {
        session_id: sessionId,
        attachment_index: 0,
        chunk_index: 0,
        nonce: "000102030405060708090a0b",
        ciphertext: btoa("sample-chunk-payload-data"),
        mac: "00112233445566778899aabbccddeeff",
        final: false,
      };

      const res = await chunkHandler({ request: createChunkRequest(validPayload) });
      expect(res.status).toBe(200);

      const session = getUploadSession(sessionId);
      expect(session?.attachments[0].uploadedChunks.has(0)).toBe(true);
      // Commitment was generated without any NaN or corruption
      const commitment = session?.attachments[0].chunkCommitments.get(0);
      expect(commitment).toBeDefined();
      expect(commitment).toMatch(/^v1:sha256:hex:[a-f0-9]{64}$/);
    });
  });
});
