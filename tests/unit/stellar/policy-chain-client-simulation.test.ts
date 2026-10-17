import { describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import {
  SorobanPolicyChainClient,
  extractBuiltUnsignedXdr,
} from "../../../src/services/stellar/policy-chain-client";
import type { BetaRuntimeConfig } from "../../../src/config/schema";

function makeConfig(): BetaRuntimeConfig {
  return {
    network: {
      stellarNetwork: "testnet",
      networkPassphrase: "Test SDF Network ; September 2015",
      horizonUrl: "https://horizon-testnet.stellar.org",
      sorobanRpcUrl: "https://soroban-testnet.stellar.org",
    },
    contract: {
      policiesContractId: "C" + "A".repeat(55),
    },
    secrets: {
      operatorSecret: Keypair.random().secret(),
    },
  } as unknown as BetaRuntimeConfig;
}

describe("SorobanPolicyChainClient assembled transaction handling (#334)", () => {
  it("surfaces simulation.error instead of throwing a property-access TypeError when built is undefined", async () => {
    const client = new SorobanPolicyChainClient(makeConfig());
    vi.spyOn(client as any, "policiesClient").mockReturnValue({
      set_policy: vi.fn().mockResolvedValue({
        built: undefined,
        simulation: { error: "HostError: Error(Contract, #2)" },
      }),
      set_sender_rule: vi.fn().mockResolvedValue({
        built: undefined,
        simulation: { error: "HostError: InvalidRule" },
      }),
      set_sender_tier: vi.fn().mockResolvedValue({
        built: undefined,
        simulation: { error: "HostError: InvalidPostage" },
      }),
    });

    const owner = Keypair.random().publicKey();
    const sender = Keypair.random().publicKey();

    await expect(
      client.submitMailboxPolicyWrite(
        owner,
        {
          allowUnknown: true,
          requireVerified: false,
          requireReceipt: false,
          minimumPostage: "100",
        },
        owner,
      ),
    ).rejects.toThrow("Simulation failed for set_policy: HostError: Error(Contract, #2)");

    await expect(
      client.submitSenderRuleWrite(owner, sender, "allow", owner),
    ).rejects.toThrow("Simulation failed for set_sender_rule: HostError: InvalidRule");

    await expect(
      client.submitSenderTierWrite(owner, sender, "500", owner),
    ).rejects.toThrow("Simulation failed for set_sender_tier: HostError: InvalidPostage");
  });

  it("throws a descriptive error when built is absent without simulation.error", () => {
    expect(() =>
      extractBuiltUnsignedXdr({ built: undefined } as any, "set_policy"),
    ).toThrow("Simulation did not produce a built transaction for set_policy");
  });

  it("extracts base64 XDR when built is present", () => {
    const xdr = extractBuiltUnsignedXdr(
      {
        built: {
          toEnvelope: () => ({ toXDR: () => "UNSIGNED_XDR_BASE64" }),
        },
      } as any,
      "set_policy",
    );
    expect(xdr).toBe("UNSIGNED_XDR_BASE64");
  });
});
