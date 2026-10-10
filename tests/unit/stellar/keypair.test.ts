import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { generateStellarKeypair } from "@/services/stellar/keypair";

describe("generateStellarKeypair", () => {
  it("generates a valid matching Stellar keypair round-trip", () => {
    const pair = generateStellarKeypair();
    const derived = Keypair.fromSecret(pair.secretKey);
    expect(derived.publicKey()).toBe(pair.publicKey);
  });

  it("produces keys with 56 characters and documented G and S prefixes", () => {
    const pair = generateStellarKeypair();

    expect(pair.publicKey).toHaveLength(56);
    expect(pair.publicKey.startsWith("G")).toBe(true);

    expect(pair.secretKey).toHaveLength(56);
    expect(pair.secretKey.startsWith("S")).toBe(true);
  });

  it("produces fresh, differing key material across consecutive calls", () => {
    const first = generateStellarKeypair();
    const second = generateStellarKeypair();

    expect(first.publicKey).not.toBe(second.publicKey);
    expect(first.secretKey).not.toBe(second.secretKey);
  });
});
