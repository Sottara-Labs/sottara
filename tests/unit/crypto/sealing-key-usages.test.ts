import { describe, expect, it, vi } from "vitest";
import { sealEnvelope } from "../../../src/services/crypto/envelope";
import { openEnvelope, type KeyProvider } from "../../../src/services/crypto/open-envelope";
import { createOpeningKey, createSealingKey } from "../../../src/services/crypto/keys";
import { getCryptoTestVectors } from "../../../src/services/crypto/testing";

vi.mock("../../../src/services/crypto/keys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/services/crypto/keys")>();
  return {
    ...actual,
    createSealingKey: vi.fn(actual.createSealingKey),
  };
});

const deterministicRandomness = (array: Uint8Array) => {
  array.fill(0x42);
  return array;
};

const withDeterministicRandomness = async <T>(run: () => Promise<T>): Promise<T> => {
  const vectors = getCryptoTestVectors();
  vectors.getRandomValues = deterministicRandomness;
  try {
    return await run();
  } finally {
    vectors.getRandomValues = undefined;
  }
};

const sealDeterministically = (body: string) =>
  withDeterministicRandomness(() => sealEnvelope({ sender: "GABC", recipient: "GXYZ", body }));

describe("sealing content key usages (#285)", () => {
  it("mints a non-extractable, encrypt-only sealing key", async () => {
    const sealingKey = vi.mocked(createSealingKey);

    await sealDeterministically("usage check");

    expect(sealingKey).toHaveBeenCalledTimes(1);
    const key = await sealingKey.mock.results[0].value;

    expect(key.extractable).toBe(false);
    expect([...key.usages]).toEqual(["encrypt"]);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });

  it("seals envelopes that open with the same raw key material", async () => {
    const rawContentKey = new Uint8Array(32).fill(0x42);

    const sealed = await sealDeterministically("round trip");

    const keyProvider: KeyProvider = {
      async resolveKey() {
        return await createOpeningKey(rawContentKey);
      },
    };
    const opened = await openEnvelope(sealed, keyProvider);

    expect(opened.body).toBe("round trip");
  });
});
