import { afterEach, describe, expect, it, vi } from "vitest";
import { generateMessageId } from "../../../src/services/crypto/random";
import {
  getCryptoTestVectors,
  resetCryptoTestVectors,
  withCryptoTestVectors,
} from "../../../src/services/crypto/testing";

const sevens = (array: Uint8Array) => array.fill(7);
const zeros = (array: Uint8Array) => array.fill(0);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetCryptoTestVectors();
});

describe("crypto test-vector scoping (#295)", () => {
  it("installs the override only inside the scope and restores the platform CSPRNG after", async () => {
    const platform = vi.fn(sevens);
    vi.stubGlobal("crypto", { getRandomValues: platform });

    let idInside = "";
    await withCryptoTestVectors({ getRandomValues: zeros }, () => {
      idInside = generateMessageId();
    });

    expect(idInside).toBe("0".repeat(32));
    expect(platform).not.toHaveBeenCalled();

    expect(getCryptoTestVectors().getRandomValues).toBeUndefined();
    expect(generateMessageId()).toBe("07".repeat(16));
    expect(platform).toHaveBeenCalled();
  });

  it("ignores the override outside a test environment", async () => {
    vi.stubEnv("STEALTH_CRYPTO_TEST_VECTORS", "");
    const platform = vi.fn(sevens);
    vi.stubGlobal("crypto", { getRandomValues: platform });

    await withCryptoTestVectors({ getRandomValues: zeros }, () => {
      expect(getCryptoTestVectors()).toEqual({});
      expect(generateMessageId()).toBe("07".repeat(16));
    });

    expect(platform).toHaveBeenCalled();
  });
});
