import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveRecipient,
  resolveRecipients,
  validateRecipientFormat,
} from "@/features/compose/recipientResolver";
import { defaultIdentityResolver } from "@/features/identity/resolver";

// Public account encoding of a synthetic, all-zero Ed25519 public key.
const account = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const secret = "S" + "A".repeat(55);
const secretInputs = [secret, secret.toLowerCase(), "s" + "Aa".repeat(27) + "A", ` \t${secret}\n`];

describe("recipient secret-key rejection", () => {
  beforeEach(() => {
    // No live identity or key-directory requests are needed for these tests.
    vi.spyOn(defaultIdentityResolver, "resolve").mockRejectedValue(new Error("unresolved"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            currentKeys: {
              encryption: { status: "active", publicKey: "synthetic-encryption-key" },
            },
          },
        }),
      }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(secretInputs)("rejects secret input %j before any lookup", async (input) => {
    const context = {
      resolveContact: vi.fn(),
      resolveFederation: vi.fn(),
      isBlockedRecipient: vi.fn(),
      getUnverifiedPolicy: vi.fn(),
    };
    const validation = validateRecipientFormat(input);
    expect(validation.valid).toBe(false);
    expect(validation.error).toContain("Secret keys cannot be used as recipients");
    expect(validation.error).not.toContain(input.trim());

    const result = await resolveRecipient(input, new Set(), context);
    expect(result.state).toBe("invalid");
    expect(result.message).toBe(validation.error);
    expect(result.resolvedAccount).toBeUndefined();
    for (const callback of Object.values(context)) {
      expect(callback).not.toHaveBeenCalled();
    }
    expect(defaultIdentityResolver.resolve).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("resolves a public G-address through the key directory", async () => {
    const resolveContact = vi.fn();
    expect(validateRecipientFormat(account).valid).toBe(true);
    const result = await resolveRecipient(` ${account.toLowerCase()} `, new Set(), {
      resolveContact,
    });
    expect(result).toMatchObject({
      state: "verified",
      resolvedAccount: account,
      keyStatus: "active",
      encryptionKey: "synthetic-encryption-key",
    });
    expect(resolveContact).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`/api/v1/identity/keys/?owner=${account}`, {
      headers: { accept: "application/json" },
      signal: undefined,
    });
  });

  it("resolves a federation address and checks its public account keys", async () => {
    const resolveFederation = vi.fn().mockResolvedValue({
      publicKey: account,
      domain: "example.com",
    });
    expect(validateRecipientFormat("alice*example.com").valid).toBe(true);
    const result = await resolveRecipient("ALICE*EXAMPLE.COM", new Set(), {
      resolveFederation,
    });
    expect(result).toMatchObject({
      state: "verified",
      resolvedAccount: account,
      provenance: "stellar_federation",
      keyStatus: "active",
      encryptionKey: "synthetic-encryption-key",
    });
    expect(resolveFederation).toHaveBeenCalledExactlyOnceWith("alice*example.com");
    expect(defaultIdentityResolver.resolve).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`/api/v1/identity/keys/?owner=${account}`, {
      headers: { accept: "application/json" },
      signal: undefined,
    });
  });

  it("rejects secrets in a mixed batch while resolving the public recipient", async () => {
    const results = await resolveRecipients([secret, account, secret.toLowerCase()]);
    expect(results.map((result) => result.state)).toEqual(["invalid", "verified", "invalid"]);
    expect(defaultIdentityResolver.resolve).toHaveBeenCalledExactlyOnceWith(account.toLowerCase(), {
      timeoutMs: 1500,
      signal: undefined,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(`/api/v1/identity/keys/?owner=${account}`, {
      headers: { accept: "application/json" },
      signal: undefined,
    });
  });
});
