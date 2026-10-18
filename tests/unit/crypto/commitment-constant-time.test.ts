/**
 * #286 — verifyCommitment must compare the declared and computed digests in
 * constant time, not with a byte-by-byte early-exit `!==`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCommitment, verifyCommitment } from "../../../src/services/crypto/commitment";
import { constantTimeEqual } from "../../../src/services/crypto/constant-time";

vi.mock("../../../src/services/crypto/constant-time", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/services/crypto/constant-time")>();
  return {
    ...actual,
    constantTimeEqual: vi.fn(actual.constantTimeEqual),
  };
});

describe("verifyCommitment digest comparison (#286)", () => {
  const comparison = () => vi.mocked(constantTimeEqual);
  const ciphertext = new Uint8Array([9, 8, 7, 6, 5, 4]);

  beforeEach(() => {
    comparison().mockClear();
  });

  it("compares the digests with constantTimeEqual on success", async () => {
    const commitment = await createCommitment(ciphertext);

    await expect(verifyCommitment(commitment, ciphertext)).resolves.toBeUndefined();
    expect(comparison()).toHaveBeenCalledTimes(1);
  });

  it("still rejects a digest that differs in its last character", async () => {
    const commitment = await createCommitment(ciphertext);
    const parts = commitment.split(":");
    parts[3] = parts[3].slice(0, -1) + (parts[3].endsWith("0") ? "1" : "0");

    await expect(verifyCommitment(parts.join(":"), ciphertext)).rejects.toThrow(
      "The content commitment did not match the payload",
    );
    expect(comparison()).toHaveBeenCalled();
  });
});
