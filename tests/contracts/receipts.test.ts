/**
 * Unit tests for Receipts contract client bindings (BETA-050 / #1957).
 *
 * Covers:
 *   - parseReceiptsError: every ReceiptsError variant maps to the correct enum value
 *   - createReceiptsClient: returns a contract.Client instance
 *   - Domain rules: DuplicateReceipt, AlreadyRead, CommitmentMismatch semantics
 *   - Boundary cases: ReceiptsError enum completeness
 */

import { describe, it, expect } from "vitest";
import {
  parseReceiptsError,
  ReceiptsError,
  createReceiptsClient,
} from "../../src/services/stellar/contracts/receipts";
import { xdr, nativeToScVal, Address } from "@stellar/stellar-sdk";

// ---------------------------------------------------------------------------
// parseReceiptsError
// ---------------------------------------------------------------------------

describe("parseReceiptsError", () => {
  const errorCases: Array<[number, ReceiptsError]> = [
    [1, ReceiptsError.DuplicateReceipt],
    [2, ReceiptsError.ReceiptNotFound],
    [3, ReceiptsError.AlreadyRead],
    [4, ReceiptsError.CommitmentMismatch],
  ];

  for (const [code, expected] of errorCases) {
    it(`maps error code ${code} to ReceiptsError.${ReceiptsError[expected]}`, () => {
      expect(parseReceiptsError(code)).toBe(expected);
    });
  }

  it("returns undefined for an unknown error code", () => {
    expect(parseReceiptsError(0)).toBeUndefined();
    expect(parseReceiptsError(5)).toBeUndefined();
    expect(parseReceiptsError(-1)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ReceiptsError enum completeness
// ---------------------------------------------------------------------------

describe("ReceiptsError enum", () => {
  it("has exactly 4 error variants", () => {
    const numericKeys = Object.values(ReceiptsError).filter((v) => typeof v === "number");
    expect(numericKeys).toHaveLength(4);
  });

  it("DuplicateReceipt (1) guards idempotent receipt creation", () => {
    expect(ReceiptsError.DuplicateReceipt).toBe(1);
  });

  it("CommitmentMismatch (4) prevents tampered payload receipts", () => {
    expect(ReceiptsError.CommitmentMismatch).toBe(4);
  });

  it("AlreadyRead (3) prevents double read-receipt marking", () => {
    expect(ReceiptsError.AlreadyRead).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// createReceiptsClient
// ---------------------------------------------------------------------------

describe("createReceiptsClient", () => {
  const DUMMY_CONTRACT_ID = "C" + "B".repeat(55);
  const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
  const TESTNET_RPC = "https://soroban-testnet.stellar.org";

  it("returns a contract.Client instance with the provided options", () => {
    const client = createReceiptsClient({
      contractId: DUMMY_CONTRACT_ID,
      networkPassphrase: TESTNET_PASSPHRASE,
      rpcUrl: TESTNET_RPC,
    });
    expect(client).toBeDefined();
    expect(typeof client).toBe("object");
  });

  it("accepts an optional publicKey without throwing", () => {
    const publicKey = "G" + "B".repeat(55);
    expect(() =>
      createReceiptsClient({
        contractId: DUMMY_CONTRACT_ID,
        networkPassphrase: TESTNET_PASSPHRASE,
        rpcUrl: TESTNET_RPC,
        publicKey,
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Domain rules
// ---------------------------------------------------------------------------

describe("ReceiptsError domain rules", () => {
  it("DuplicateReceipt is distinct from AlreadyRead", () => {
    expect(ReceiptsError.DuplicateReceipt).not.toBe(ReceiptsError.AlreadyRead);
  });

  it("ReceiptNotFound (2) is the lookup-miss sentinel", () => {
    expect(parseReceiptsError(2)).toBe(ReceiptsError.ReceiptNotFound);
  });

  it("CommitmentMismatch (4) is the integrity failure sentinel", () => {
    expect(parseReceiptsError(4)).toBe(ReceiptsError.CommitmentMismatch);
  });

  it("malformed code (non-integer) returns undefined gracefully", () => {
    // parseReceiptsError expects a number; we test that NaN and floats are
    // treated the same way as unknown codes.
    expect(parseReceiptsError(NaN)).toBeUndefined();
    expect(parseReceiptsError(1.5)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Result payload decoding (Ok / Err)
// ---------------------------------------------------------------------------

/**
 * Build a real `ScVal` union representing a contract result.
 *
 * Soroban contract calls return `ScVal::Result` (a `Result<Val, Val>` union).
 * These helpers construct genuine `xdr.ScVal` values so the bindings decode
 * the same wire shape the contract emits on-chain.
 */
function okScVal(value: xdr.ScVal): xdr.ScVal {
  return xdr.ScVal.scvResult(
    new xdr.ScValResult({
      switch: xdr.ScValType.scvVoid(),
      ok: value,
    }),
  );
}

function errScVal(value: xdr.ScVal): xdr.ScVal {
  return xdr.ScVal.scvResult(
    new xdr.ScValResult({
      switch: xdr.ScValType.scvVoid(),
      error: value,
    }),
  );
}

describe("Receipts result payload decoding", () => {
  const DUMMY_CONTRACT_ID = "C" + "B".repeat(55);
  const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
  const TESTNET_RPC = "https://soroban-testnet.stellar.org";

  const client = createReceiptsClient({
    contractId: DUMMY_CONTRACT_ID,
    networkPassphrase: TESTNET_PASSPHRASE,
    rpcUrl: TESTNET_RPC,
  });

  it("decodes a real Ok payload into a typed receipt", () => {
    const receiptId = nativeToScVal(42n, { type: "u64" });
    const commitment = nativeToScVal(Buffer.alloc(32, 0xab), { type: "bytes" });
    const owner = new Address("G" + "B".repeat(55));

    const okPayload = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: nativeToScVal("id", { type: "symbol" }),
        val: receiptId,
      }),
      new xdr.ScMapEntry({
        key: nativeToScVal("commitment", { type: "symbol" }),
        val: commitment,
      }),
      new xdr.ScMapEntry({
        key: nativeToScVal("owner", { type: "symbol" }),
        val: owner.toScVal(),
      }),
    ]);

    const decoded = client.decodeResult(okScVal(okPayload));

    expect(decoded.isOk()).toBe(true);
    const receipt = decoded.unwrap();
    expect(receipt.id).toBe(42n);
    expect(Buffer.from(receipt.commitment)).toEqual(Buffer.alloc(32, 0xab));
    expect(receipt.owner).toBe(owner.toString());
  });

  it("decodes a real Err payload into a typed ReceiptsError", () => {
    const errPayload = nativeToScVal(ReceiptsError.DuplicateReceipt, {
      type: "u32",
    });

    const decoded = client.decodeResult(errScVal(errPayload));

    expect(decoded.isErr()).toBe(true);
    expect(decoded.unwrapErr()).toBe(ReceiptsError.DuplicateReceipt);
  });

  it("decodes a CommitmentMismatch Err payload", () => {
    const errPayload = nativeToScVal(ReceiptsError.CommitmentMismatch, {
      type: "u32",
    });

    const decoded = client.decodeResult(errScVal(errPayload));

    expect(decoded.isErr()).toBe(true);
    expect(decoded.unwrapErr()).toBe(ReceiptsError.CommitmentMismatch);
  });

  it("fails when the Ok receipt shape changes", () => {
    // A receipt missing the `commitment` field must not decode as a valid
    // receipt — this guards against silent shape drift in the contract result.
    const malformedOk = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: nativeToScVal("id", { type: "symbol" }),
        val: nativeToScVal(42n, { type: "u64" }),
      }),
    ]);

    expect(() => client.decodeResult(okScVal(malformedOk))).toThrow();
  });
});
