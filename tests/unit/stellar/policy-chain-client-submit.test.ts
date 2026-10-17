import { describe, expect, it, vi } from "vitest";
import { Keypair, Networks, TransactionBuilder, Operation, Account } from "@stellar/stellar-sdk";
import {
  SorobanPolicyChainClient,
  PolicyTransactionFailedError,
} from "../../../src/services/stellar/policy-chain-client";
import type { BetaRuntimeConfig } from "../../../src/config/schema";

function makeConfig(): BetaRuntimeConfig {
  return {
    network: {
      stellarNetwork: "testnet",
      networkPassphrase: Networks.TESTNET,
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

function makeDummySignedXdr(): string {
  const kp = Keypair.random();
  const account = new Account(kp.publicKey(), "1");
  const tx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.bumpSequence({ bumpTo: "2" }))
    .setTimeout(30)
    .build();
  tx.sign(kp);
  return tx.toXDR();
}

describe("SorobanPolicyChainClient.submitSignedXdr (#332)", () => {
  it("throws PolicyTransactionFailedError when pollTransaction returns FAILED", async () => {
    const client = new SorobanPolicyChainClient(makeConfig());
    const rpcServer = (client as any).rpc;
    vi.spyOn(rpcServer, "sendTransaction").mockResolvedValue({
      status: "PENDING",
      hash: "deadbeef1234",
    });
    vi.spyOn(rpcServer, "pollTransaction").mockResolvedValue({
      status: "FAILED",
      resultXdr: {
        result: () => ({
          switch: () => ({ name: "txFailed" }),
        }),
      },
    });

    await expect(
      (client as any).submitSignedXdr(makeDummySignedXdr()),
    ).rejects.toThrowError(PolicyTransactionFailedError);

    await expect(
      (client as any).submitSignedXdr(makeDummySignedXdr()),
    ).rejects.toThrow("Policy transaction deadbeef1234 failed on-chain (FAILED): txFailed");
  });

  it("returns txHash when pollTransaction returns SUCCESS", async () => {
    const client = new SorobanPolicyChainClient(makeConfig());
    const rpcServer = (client as any).rpc;
    vi.spyOn(rpcServer, "sendTransaction").mockResolvedValue({
      status: "PENDING",
      hash: "cafebabe5678",
    });
    vi.spyOn(rpcServer, "pollTransaction").mockResolvedValue({
      status: "SUCCESS",
    });

    const res = await (client as any).submitSignedXdr(makeDummySignedXdr());
    expect(res).toEqual({ txHash: "cafebabe5678" });
  });
});
