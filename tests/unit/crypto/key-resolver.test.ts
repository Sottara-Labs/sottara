import { describe, expect, it } from "vitest";

import {
  DirectoryRecipientKeyResolver,
  resolveTrustedKey,
  ResolverError,
  validateResolvedKey,
  type RecipientKeyResolver,
  type ResolvedKey,
} from "../../../src/services/crypto/key-resolver";

function makeKey(overrides: Partial<ResolvedKey> = {}): ResolvedKey {
  return {
    recipient: "GABC",
    publicKey: new Uint8Array([1, 2, 3, 4]),
    keyId: "k1",
    notBefore: "2020-01-01T00:00:00Z",
    notAfter: "2099-01-01T00:00:00Z",
    revoked: false,
    provenance: "trusted-directory",
    ...overrides,
  };
}

describe("recipient key resolution (#1712)", () => {
  it("accepts a valid, bound, unexpired key", () => {
    const key = validateResolvedKey(makeKey(), "GABC");
    expect(key.keyId).toBe("k1");
  });

  it("rejects a key bound to a different recipient", () => {
    expect(() => validateResolvedKey(makeKey(), "GOTHER")).toThrowError(ResolverError);
  });

  it("rejects revoked keys", () => {
    expect(() => validateResolvedKey(makeKey({ revoked: true }), "GABC")).toThrowError(
      ResolverError,
    );
  });

  it("rejects expired keys", () => {
    const expired = makeKey({ notAfter: "2020-01-02T00:00:00Z" });
    expect(() => validateResolvedKey(expired, "GABC")).toThrowError(ResolverError);
  });

  it("rejects not-yet-valid keys", () => {
    const future = makeKey({ notBefore: "2099-01-01T00:00:00Z" });
    expect(() => validateResolvedKey(future, "GABC")).toThrowError(ResolverError);
  });

  it("rejects keys with no public material", () => {
    expect(() =>
      validateResolvedKey(makeKey({ publicKey: new Uint8Array(0) }), "GABC"),
    ).toThrowError(ResolverError);
  });

  it("resolveTrustedKey uses the resolver then validates", async () => {
    const trusted: RecipientKeyResolver = {
      resolve: async (recipient) => makeKey({ recipient }),
    };
    const key = await resolveTrustedKey(trusted, "GABC");
    expect(key.recipient).toBe("GABC");
  });

  it("resolveTrustedKey rejects an untrusted (revoked) resolver result", async () => {
    const untrusted: RecipientKeyResolver = {
      resolve: async () => makeKey({ revoked: true }),
    };
    await expect(resolveTrustedKey(untrusted, "GABC")).rejects.toBeInstanceOf(ResolverError);
  });
});

describe("directory key material decoding (#291)", () => {
  const directoryKey = (publicKey: unknown) => ({
    currentKeys: {
      encryption: {
        publicKey,
        keyId: "k1",
        notBefore: "2020-01-01T00:00:00Z",
        notAfter: "2099-01-01T00:00:00Z",
        status: "active",
        version: 1,
      },
    },
    historicalKeys: [],
    allKeys: [],
  });

  const resolverWith = (publicKey: unknown) =>
    new DirectoryRecipientKeyResolver(async () => directoryKey(publicKey));

  it("accepts a hex-encoded directory key", async () => {
    const key = await resolverWith("ab".repeat(32)).resolve("GABC");
    expect(key.publicKey).toEqual(new Uint8Array(32).fill(0xab));
  });

  it("accepts a base64-encoded directory key", async () => {
    const bytes = new Uint8Array(32).fill(0xab);
    const base64 = btoa(String.fromCharCode(...bytes));
    const key = await resolverWith(base64).resolve("GABC");
    expect(key.publicKey).toEqual(bytes);
  });

  it("fails closed when the directory key is neither hex nor base64", async () => {
    await expect(resolverWith("hello world").resolve("GABC")).rejects.toBeInstanceOf(ResolverError);
  });
});
