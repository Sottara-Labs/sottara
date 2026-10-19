/**
 * Internal dependency injection for deterministic cryptographic tests.
 *
 * NEVER EXPORT THIS FROM PUBLIC INDEX. NEVER USE IN PRODUCTION.
 *
 * The override is scoped to a callback via {@link withCryptoTestVectors} and is
 * only honoured while the test-only flag is set. Outside that scope
 * getCryptoTestVectors() returns an empty object, so production modules
 * always fall back to the platform CSPRNG. This prevents a forgotten
 * teardown from leaking a predictable random source process-wide.
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

/** The active vectors, only read when the test-only flag is set. */
let currentVectors: CryptoTestVectors = {};

/** Test-only flag. When false, getCryptoTestVectors() always returns {}. */
let testOverrideEnabled = false;

/**
 * Install a crypto test-vector override for the duration of a callback.
 *
 * The override is active only inside the callback and is always restored
 * (even on throw), so it cannot outlive the test that installed it. This is
 * the only supported way to install vectors.
 */
export async function withCryptoTestVectors<T>(
  vectors: CryptoTestVectors,
  factory: () => T | Promise<T>,
): Promise<T> {
  const previousVectors = currentVectors;
  const previousEnabled = testOverrideEnabled;

  currentVectors = { ...previousVectors, ...vectors };
  testOverrideEnabled = true;

  try {
    return await factory();
  } finally {
    currentVectors = previousVectors;
    testOverrideEnabled = previousEnabled;
  }
}

/**
 * Lower-level install hook. Prefer {@link withCryptoTestVectors} in tests,
 * which guarantees restoration. This function is kept for advanced cases
 * and must be paired with {@link resetCryptoTestVectors}.
 */
export function setCryptoTestVectors(vectors: CryptoTestVectors): void {
  currentVectors = { ...currentVectors, ...vectors };
  testOverrideEnabled = true;
}

export function resetCryptoTestVectors(): void {
  currentVectors = {};
  testOverrideEnabled = false;
}

/**
 * Return the active test vectors. When the test-only flag is not set
 * (e.g. in production or after a scope exits) this always returns an empty
 * object, so consumers fall back to the platform implementation.
 */
export function getCryptoTestVectors(): CryptoTestVectors {
  if (!testOverrideEnabled) {
    return {};
  }
  return currentVectors;
}
