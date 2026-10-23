/**
 * Internal dependency injection for deterministic cryptographic tests.
 *
 * NEVER EXPORT THIS FROM PUBLIC INDEX. NEVER USE IN PRODUCTION.
 *
 * Install overrides only through `withCryptoTestVectors`, which restores the
 * previous vector set when the scope settles, so an override cannot outlive
 * the test that installed it. On top of that, `getCryptoTestVectors` reports
 * vectors only while the test-only flag `STEALTH_CRYPTO_TEST_VECTORS=1` is set
 * (vitest.config.ts sets it for the suite); production builds never set it,
 * so a stray install is ignored entirely there.
 */

export interface CryptoTestVectors {
  getRandomValues?: (array: Uint8Array) => Uint8Array;
  now?: () => Date;
  generateKey?: (
    algorithm:
      | AlgorithmIdentifier
      | RsaHashedKeyGenParams
      | EcKeyGenParams
      | HmacKeyGenParams
      | AesKeyGenParams,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ) => Promise<any>;
}

let currentVectors: CryptoTestVectors = {};

/**
 * Runs `fn` with `vectors` installed and restores the previous vector set
 * when it settles (sync or async). This is the only supported way to install
 * vectors: the override is scoped to the callback and cannot leak past it.
 */
export async function withCryptoTestVectors<T>(
  vectors: CryptoTestVectors,
  fn: () => T | Promise<T>,
): Promise<T> {
  const previous = currentVectors;
  currentVectors = { ...previous, ...vectors };
  try {
    return await fn();
  } finally {
    currentVectors = previous;
  }
}

/** Clears any installed vectors. */
export function resetCryptoTestVectors(): void {
  currentVectors = {};
}

function overrideEnabled(): boolean {
  if (typeof process !== "undefined" && process.env?.STEALTH_CRYPTO_TEST_VECTORS === "1") {
    return true;
  }
  return (
    (import.meta as { env?: { STEALTH_CRYPTO_TEST_VECTORS?: string } }).env
      ?.STEALTH_CRYPTO_TEST_VECTORS === "1"
  );
}

/** Installed test vectors, or an empty set outside a test environment. */
export function getCryptoTestVectors(): CryptoTestVectors {
  return overrideEnabled() ? currentVectors : {};
}
