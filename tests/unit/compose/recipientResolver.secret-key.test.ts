import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultIdentityResolver } from "@/features/identity/resolver";
import { fetchKeyDirectory } from "@/features/compose/recipientKeyResolution";
import {
  resolveRecipient,
  resolveRecipients,
  validateRecipientFormat,
} from "@/features/compose/recipientResolver";

vi.mock("@/features/identity/resolver", () => ({
  defaultIdentityResolver: { resolve: vi.fn() },
  IdentityResolverService: class {},
  LOCAL_STEALTH_DOMAINS: new Set(["stealth.me", "stealth.xyz"]),
}));
vi.mock("@/features/compose/recipientKeyResolution", () => ({
  fetchKeyDirectory: vi.fn(),
}));

// Synthetic format-only fixtures; these are not wallet credentials.
const secret = "S" + "A".repeat(55);
const account = "G" + "A".repeat(55);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(defaultIdentityResolver.resolve).mockResolvedValue({
    resolved: false,
  } as Awaited<ReturnType<typeof defaultIdentityResolver.resolve>>);
  vi.mocked(fetchKeyDirectory).mockResolvedValue(null);
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe("secret-key recipient rejection", () => {
  it.each([secret, secret.toLowerCase(), "s" + "A".repeat(55), ` \t${secret}\n`])(
    "rejects secret-shaped input without lookup or error disclosure (%#)",
    async (input) => {
      const validation = validateRecipientFormat(input);
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain("Secret keys");
      expect(validation.error?.toLowerCase()).not.toContain(secret.toLowerCase());

      const context = {
        resolveContact: vi.fn(),
        resolveFederation: vi.fn(),
        isBlockedRecipient: vi.fn(),
      };
      const result = await resolveRecipient(input, new Set(), context);
      expect(result.state).toBe("invalid");
      expect(result.message).toBe(validation.error);
      expect(context.resolveContact).not.toHaveBeenCalled();
      expect(context.resolveFederation).not.toHaveBeenCalled();
      expect(context.isBlockedRecipient).not.toHaveBeenCalled();
      expect(defaultIdentityResolver.resolve).not.toHaveBeenCalled();
      expect(fetchKeyDirectory).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("continues resolving public accounts through the key directory", async () => {
    expect(validateRecipientFormat(account).valid).toBe(true);
    const contact = vi.fn();
    const result = await resolveRecipient(account.toLowerCase(), new Set(), {
      resolveContact: contact,
    });
    expect(result.state).toBe("unknown");
    expect(contact).not.toHaveBeenCalled();
    expect(fetchKeyDirectory).toHaveBeenCalledWith(account, undefined);
  });

  it("preserves federation resolution and rejects secrets within batches", async () => {
    const resolveFederation = vi.fn().mockResolvedValue({
      publicKey: account,
      domain: "example.org",
    });
    expect(validateRecipientFormat("alice*example.org").valid).toBe(true);
    const results = await resolveRecipients([secret, "alice*example.org"], [], {
      resolveFederation,
    });
    expect(results.map((result) => result.state)).toEqual(["invalid", "verified"]);
    expect(resolveFederation).toHaveBeenCalledExactlyOnceWith("alice*example.org");
    expect(fetchKeyDirectory).toHaveBeenCalledExactlyOnceWith(account, undefined);
    expect(defaultIdentityResolver.resolve).not.toHaveBeenCalled();
  });

  it.each(["sam", "susan_smith", "susan@stealth.me"])(
    "preserves ordinary S-prefixed aliases and local handles: %s",
    (input) => expect(validateRecipientFormat(input).valid).toBe(true),
  );
});
