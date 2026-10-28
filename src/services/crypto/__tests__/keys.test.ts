import { describe, it, expect } from "vitest";
import { createSigningKeyPair, createVerificationKey } from "../keys";

describe("createSigningKeyPair", () => {
  it("generates an Ed25519 key pair that can sign and verify", async () => {
    const { signingKey, verificationKey } = await createSigningKeyPair();

    // The key algorithm must be Ed25519 to match verifyEnvelopeSignature
    expect(signingKey.algorithm.name).toBe("Ed25519");
    expect(verificationKey.algorithm.name).toBe("Ed25519");

    // Sign a test payload
    const data = new TextEncoder().encode("test-payload");
    const signature = await crypto.subtle.sign("Ed25519", signingKey, data);

    // Verify with the public key — must succeed
    const valid = await crypto.subtle.verify("Ed25519", verificationKey, signature, data);
    expect(valid).toBe(true);
  });

  it("does not generate ECDSA P-256 keys", async () => {
    const { signingKey } = await createSigningKeyPair();
    // The previous bug generated ECDSA P-256 keys that couldn't verify
    // against the project's Ed25519 verification path
    expect(signingKey.algorithm.name).not.toBe("ECDSA");
  });
});

describe("createVerificationKey", () => {
  it("imports an Ed25519 public key from SPKI DER", async () => {
    // Generate a key pair to get a valid SPKI public key
    const pair = await createSigningKeyPair();
    const spki = await crypto.subtle.exportKey("spki", pair.verificationKey);
    const spkiBytes = new Uint8Array(spki);

    const imported = await createVerificationKey(spkiBytes);
    expect(imported.algorithm.name).toBe("Ed25519");
  });
});
