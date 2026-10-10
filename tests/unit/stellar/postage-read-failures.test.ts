import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PostageEscrowAdapter,
  type PostageOperation,
} from "../../../src/services/stellar/postage-escrow";
import { PostageError, type Postage } from "../../../src/services/stellar/contracts/postage";
import type { BetaRuntimeConfig } from "../../../src/config/schema";

const chain = vi.hoisted(() => ({
  createPostageClient: vi.fn(),
  get: vi.fn(),
  submit: vi.fn(),
  settle: vi.fn(),
  refund: vi.fn(),
  dispute: vi.fn(),
  expire: vi.fn(),
  reclaim: vi.fn(),
}));

vi.mock("../../../src/services/stellar/contracts/postage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/services/stellar/contracts/postage")>()),
  ...chain,
}));

const messageId = "a".repeat(64);
const sender = "G" + "B".repeat(55);
const recipient = "G" + "A".repeat(55);
const record: Postage = {
  amount: 1000n,
  created_at: 1000n,
  dispute_until: 2000n,
  expires_at: 3000n,
  fee: 100n,
  recipient,
  sender,
  status: 0,
};
const operations: PostageOperation[] = [
  "submit",
  "settle",
  "refund",
  "dispute",
  "expire",
  "reclaim",
];

function adapter() {
  return new PostageEscrowAdapter({
    config: {
      network: {
        stellarNetwork: "testnet",
        sorobanRpcUrl: "https://rpc.example.invalid",
        networkPassphrase: "Test SDF Network ; September 2015",
      },
      contract: { postageContractId: "C_ISOLATED_POSTAGE_FIXTURE" },
    } as BetaRuntimeConfig,
    managedWallet: {} as never,
  });
}

function found() {
  return { isOk: () => true, unwrap: () => record };
}

function contractFailure(code: number) {
  return { isOk: () => false, unwrapErr: () => ({ message: `Error(Contract, #${code})` }) };
}

function invoke(target: PostageEscrowAdapter, operation: PostageOperation) {
  switch (operation) {
    case "submit":
      return target.submitEscrow(messageId, sender, recipient, 1000n);
    case "settle":
      return target.settleEscrow(messageId, recipient);
    case "refund":
      return target.refundEscrow(messageId, recipient);
    case "dispute":
      return target.disputeEscrow(messageId, recipient);
    case "expire":
      return target.expireEscrow(messageId, sender);
    case "reclaim":
      return target.reclaimEscrow(messageId, sender);
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  chain.createPostageClient.mockReturnValue({});
  for (const operation of operations) {
    chain[operation].mockRejectedValue(new Error("ETIMEDOUT submitting operation"));
  }
});

describe("on-chain postage reads", () => {
  it("returns the authoritative record and passes the exact message id", async () => {
    chain.get.mockResolvedValue(found());
    await expect(adapter().readOnChainPostage(messageId)).resolves.toBe(record);
    expect(chain.get).toHaveBeenCalledWith({}, Buffer.from(messageId, "hex"));
  });

  it("returns null only for an explicit PostageNotFound result", async () => {
    chain.get.mockResolvedValue(contractFailure(PostageError.PostageNotFound));
    await expect(adapter().readOnChainPostage(messageId)).resolves.toBeNull();
  });

  it.each([PostageError.InvalidAmount, PostageError.NotInitialized])(
    "reports contract failure %s separately from absence",
    async (code) => {
      chain.get.mockResolvedValue(contractFailure(code));
      await expect(adapter().readOnChainPostage(messageId)).rejects.toMatchObject({
        name: "PostageReadError",
        message: expect.stringContaining(`Error(Contract, #${code})`),
      });
    },
  );

  it.each([undefined, {}, { isOk: () => true, unwrap: () => undefined }])(
    "reports a malformed response separately from absence (%s)",
    async (response) => {
      chain.get.mockResolvedValue(response);
      await expect(adapter().readOnChainPostage(messageId)).rejects.toMatchObject({
        name: "PostageReadError",
      });
    },
  );

  it("reports client creation failure separately from absence", async () => {
    chain.createPostageClient.mockImplementationOnce(() => {
      throw new Error("invalid client configuration");
    });
    await expect(adapter().readOnChainPostage(messageId)).rejects.toMatchObject({
      name: "PostageReadError",
      message: expect.stringContaining("invalid client configuration"),
    });
    expect(chain.get).not.toHaveBeenCalled();
  });

  it("bounds and redacts transport diagnostics without retaining a raw cause", async () => {
    const syntheticSecret = "S" + "A".repeat(55);
    const syntheticXdr = "B".repeat(250);
    chain.get.mockRejectedValue(
      new Error(`ETIMEDOUT ${syntheticSecret} ${syntheticXdr} ${"e".repeat(600)}`),
    );
    const error = await adapter()
      .readOnChainPostage(messageId)
      .catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: "PostageReadError" });
    const message = (error as Error).message;
    expect(message).toContain("ETIMEDOUT");
    expect(message).not.toContain(syntheticSecret);
    expect(message).not.toContain(syntheticXdr);
    expect(message.length).toBeLessThanOrEqual(500);
    expect((error as Error).cause).toBeUndefined();
  });
});

describe.each(operations)("%s retry reconciliation", (operation) => {
  it("confirms success only when the recovery read finds a record", async () => {
    chain.get.mockResolvedValue(found());
    await expect(invoke(adapter(), operation)).resolves.toMatchObject({
      success: true,
      postage: record,
      chainStatus: "confirmed",
      retryClassification: "safe",
    });
  });

  it("keeps genuine absence unsuccessful while retaining the original retry policy", async () => {
    chain.get.mockResolvedValue(contractFailure(PostageError.PostageNotFound));
    await expect(invoke(adapter(), operation)).resolves.toMatchObject({
      success: false,
      chainStatus: "failed",
      retryClassification: "safe",
      lastError: "ETIMEDOUT submitting operation",
    });
  });

  it("classifies a failed recovery read as unknown and preserves both diagnostics", async () => {
    chain.get.mockRejectedValue(new Error("RPC read unavailable"));
    await expect(invoke(adapter(), operation)).resolves.toMatchObject({
      success: false,
      chainStatus: "failed",
      retryClassification: "unknown",
      lastError: expect.stringContaining("RPC read unavailable"),
    });
    const result = await invoke(adapter(), operation);
    expect(result.lastError).toContain("ETIMEDOUT submitting operation");
    expect(result.postage).toBeUndefined();
    expect(result.confirmation).toBeUndefined();
  });
});
