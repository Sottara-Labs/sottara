import { describe, expect, it } from "vitest";
import { StrKey } from "@stellar/stellar-sdk";
import { canonicalizePayload, type EnvelopePayload } from "../../../src/services/crypto/envelope";
import { toHex } from "../../../src/services/crypto/codec";
import { createSigningKeyPair } from "../../../src/services/crypto/keys";
import { envelopeSignatureSchema } from "../../../src/services/crypto/schema";
import {
  ENVELOPE_SIGNATURE_DOMAIN,
  verifyEnvelopeSignature,
  type EnvelopeSignature,
} from "../../../src/services/crypto/signature";

const encoder = new TextEncoder();

function payloadFor(sender: string): EnvelopePayload {
  return {
    version: "v1",
    sender,
    recipient: StrKey.encodeEd25519PublicKey(Buffer.from(new Uint8Array(32).fill(9))),
    timestamp: "2026-10-18T09:00:00.000Z",
    encryption_metadata: {
      algorithm: "AES-256-GCM",
      nonce: "0102030405060708090a0b0c",
      mac: "0102030405060708090a0b0c0d0e0f10",
    },
    content_commitment: `v1:sha256:hex:${"a".repeat(64)}`,
    attachments: [],
  };
}

describe("signing key pair aligns with the Ed25519 verification path (#293)", () => {
  it("signs a payload that verifyEnvelopeSignature accepts", async () => {
    const { signingKey, verificationKey } = await createSigningKeyPair();

    const rawPublicKey = new Uint8Array(await crypto.subtle.exportKey("raw", verificationKey));
    expect(rawPublicKey).toHaveLength(32);
    const sender = StrKey.encodeEd25519PublicKey(Buffer.from(rawPublicKey));
    const payload = payloadFor(sender);

    const dataToSign = encoder.encode(ENVELOPE_SIGNATURE_DOMAIN + canonicalizePayload(payload));
    const signatureBytes = new Uint8Array(
      await crypto.subtle.sign({ name: "Ed25519" }, signingKey, dataToSign as BufferSource),
    );

    const signature: EnvelopeSignature = {
      scheme: signingKey.algorithm.name as "Ed25519",
      signerAddress: sender,
      value: toHex(signatureBytes),
    };

    // The factory's algorithm identifier must satisfy the signature schema.
    expect(envelopeSignatureSchema.safeParse(signature).success).toBe(true);
    expect(signature.scheme).toBe("Ed25519");

    expect(verifyEnvelopeSignature(payload, signature, sender)).toBe(true);

    // Tampering with the payload invalidates the signature.
    const tampered: EnvelopePayload = {
      ...payload,
      recipient: StrKey.encodeEd25519PublicKey(Buffer.from(new Uint8Array(32).fill(10))),
    };
    expect(verifyEnvelopeSignature(tampered, signature, sender)).toBe(false);
  });

  it("keeps least-privilege usages for the Ed25519 pair", async () => {
    const { signingKey, verificationKey } = await createSigningKeyPair();

    expect(signingKey.algorithm.name).toBe("Ed25519");
    expect(signingKey.usages).toEqual(["sign"]);
    expect(signingKey.extractable).toBe(false);
    expect(verificationKey.usages).toEqual(["verify"]);
  });
});
