import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import {
  createPolicyChainClient,
  getPolicyChainClient,
  InMemoryPolicyChainClient,
  SorobanPolicyChainClient,
  setPolicyChainClientForTests,
} from "../../../src/services/stellar/policy-chain-client";
import type { BetaRuntimeConfig } from "../../../src/config/schema";

function makeConfig(
  profile: "production" | "preview" | "development" | "test",
  operatorSecret?: string,
): BetaRuntimeConfig {
  return {
    network: {
      network: profile,
      stellarNetwork: "testnet",
      networkPassphrase: "Test SDF Network ; September 2015",
      horizonUrl: "https://horizon-testnet.stellar.org",
      sorobanRpcUrl: "https://soroban-testnet.stellar.org",
    },
    contract: {
      policiesContractId: "C" + "A".repeat(55),
    },
    secrets: {
      ...(operatorSecret ? { operatorSecret } : {}),
    },
  } as unknown as BetaRuntimeConfig;
}

describe("createPolicyChainClient production fail-closed behavior (#331)", () => {
  beforeEach(() => {
    setPolicyChainClientForTests(null);
  });

  afterEach(() => {
    setPolicyChainClientForTests(null);
  });

  it("throws a startup configuration error when operatorSecret is missing in production", () => {
    const prodConfig = makeConfig("production");
    expect(() => createPolicyChainClient(prodConfig)).toThrow(
      /STEALTH_OPERATOR_SECRET/,
    );
    expect(() =>
      getPolicyChainClient(prodConfig, { allowInMemoryFallback: true }),
    ).toThrow(/STEALTH_OPERATOR_SECRET/);
  });

  it("never selects InMemoryPolicyChainClient in production or preview when Soroban construction fails", () => {
    const invalidProdConfig = makeConfig("production", "INVALID_SECRET_SEED");
    expect(() => createPolicyChainClient(invalidProdConfig)).toThrow();

    const previewConfig = makeConfig("preview");
    expect(() => createPolicyChainClient(previewConfig)).toThrow(
      /STEALTH_OPERATOR_SECRET/,
    );
  });

  it("constructs SorobanPolicyChainClient in production when operatorSecret is valid", () => {
    const prodConfig = makeConfig("production", Keypair.random().secret());
    const client = createPolicyChainClient(prodConfig);
    expect(client).toBeInstanceOf(SorobanPolicyChainClient);
    expect(client).not.toBeInstanceOf(InMemoryPolicyChainClient);
  });

  it("allows InMemoryPolicyChainClient only in test/development profiles when operatorSecret is omitted", () => {
    const testConfig = makeConfig("test");
    const client = createPolicyChainClient(testConfig);
    expect(client).toBeInstanceOf(InMemoryPolicyChainClient);
  });
});
