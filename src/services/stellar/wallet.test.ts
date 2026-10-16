import { afterEach, describe, expect, it } from "vitest";
import { generateKeyPair, sign } from "@stellar/edwards-signatures";
import { authorizeSend, normalizeSignature } from "./wallet";
import { envelopeSignatureSchema } from "../crypto/schema";

const SIGNER_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function installFreighterStub(signedMessage: unknown) {
  (globalThis as unknown as { __freighterApi?: unknown }).__freighterApi = {
    isConnected: async () => ({ isConnected: true }),
    requestAccess: async () => ({ address: SIGNER_ADDRESS }),
    signMessage: async () => ({ signedMessage, signerAddress: SIGNER_ADDRESS }),
  };
}

function clearFreighterStub() {
  delete (globalThis as unknown as { __freighterApi?: unknown }).__freighterApi;
}

describe("normalizeSignature", () => {
  it("normalises a base64 signature to 128 hex characters", () => {
    const keypair = generateKeyPair();
    const message = Buffer.from("canonical envelope payload");
    const signature = sign(message, keypair.secretKey);
    const base64 = Buffer.from(signature).toString("base64");

    const normalised = normalizeSignature(base64);

    expect(normalised).toMatch(/^[a-f0-9]{128}$/);
    expect(normalised).toBe(Buffer.from(signature).toString("hex"));
  });

  it("accepts an already-normalised hex signature", () => {
    const hex = "ab".repeat(64);
    expect(normalizeSignature(hex)).toBe(hex);
  });

  it("throws on a malformed length", () => {
    expect(() => normalizeSignature("aaaa")).toThrow(/Signature must be 64 bytes/);
  });
});

describe("authorizeSend", () => {
  afterEach(() => {
    clearFreighterStub();
  });

  it("verifies a base64 signature from signMessage against the Ed25519 path", async () => {
    const keypair = generateKeyPair();
    const payload = "canonical envelope payload";
    const message = Buffer.from(payload);
    const signature = sign(message, keypair.secretKey);
    const base64 = Buffer.from(signature).toString("base64");

    installFreighterStub(base64);

    const result = await authorizeSend(payload);
    const parsed = envelopeSignatureSchema.parse(result);

    expect(parsed.value).toMatch(/^[a-f0-9]{128}$/);
    expect(Buffer.from(parsed.value, "hex")).toEqual(Buffer.from(signature));
  });
});
