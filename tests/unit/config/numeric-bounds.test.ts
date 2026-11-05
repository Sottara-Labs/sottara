import { describe, expect, it, vi } from "vitest";
import { loadRuntimeConfig, parseNumber } from "../../../src/config";

vi.mock("../../../src/config/registry", () => ({
  validateRegistryDrift: vi.fn(),
}));

describe("BETA-081 / Issue #529: Strict numeric parsing and per-field bounds", () => {
  describe("parseNumber parser contract", () => {
    it("returns fallback for undefined, null, and empty strings", () => {
      expect(parseNumber(undefined, 42, "TEST_VAR")).toBe(42);
      expect(parseNumber(null, 42, "TEST_VAR")).toBe(42);
      expect(parseNumber("", 42, "TEST_VAR")).toBe(42);
      expect(parseNumber("   ", 42, "TEST_VAR")).toBe(42);
    });

    it("accepts valid decimal integers (strings and numbers)", () => {
      expect(parseNumber(300000, 10, "TEST_VAR")).toBe(300000);
      expect(parseNumber("300000", 10, "TEST_VAR")).toBe(300000);
      expect(parseNumber("-15", 10, "TEST_VAR")).toBe(-15);
      expect(parseNumber("+15", 10, "TEST_VAR")).toBe(15);
      expect(parseNumber("0", 10, "TEST_VAR")).toBe(0);
    });

    const malformedCases = [
      { input: "300000abc", desc: "trailing alphabetical characters" },
      { input: "1e5", desc: "exponential/scientific notation" },
      { input: "0x10", desc: "hexadecimal literal" },
      { input: "12.34", desc: "decimal point string" },
      { input: 12.34, desc: "floating point number" },
      { input: NaN, desc: "NaN" },
      { input: Infinity, desc: "Infinity" },
      { input: "abc300", desc: "leading alphabetical characters" },
      { input: true, desc: "boolean" },
      { input: {}, desc: "object" },
    ];

    malformedCases.forEach(({ input, desc }) => {
      it(`rejects malformed input (${desc}) and names the offending variable`, () => {
        expect(() => parseNumber(input, 100, "STEALTH_AUTH_CHALLENGE_LIFETIME_MS")).toThrowError(
          /STEALTH_AUTH_CHALLENGE_LIFETIME_MS/,
        );
      });
    });
  });

  describe("loadRuntimeConfig fail-fast on malformed settings", () => {
    it('fails fast naming the variable when "300000abc" is supplied', () => {
      expect(() =>
        loadRuntimeConfig({
          profile: "development",
          env: {
            STEALTH_AUTH_CHALLENGE_LIFETIME_MS: "300000abc",
          },
        }),
      ).toThrowError(/STEALTH_AUTH_CHALLENGE_LIFETIME_MS/);
    });

    it("fails fast naming the variable for other numeric env vars with malformed inputs", () => {
      expect(() =>
        loadRuntimeConfig({
          profile: "development",
          env: {
            STEALTH_RELAY_TIMEOUT_MS: "10000ms",
          },
        }),
      ).toThrowError(/STEALTH_RELAY_TIMEOUT_MS/);

      expect(() =>
        loadRuntimeConfig({
          profile: "development",
          env: {
            STEALTH_VERIFICATION_MAX_ATTEMPTS: "5attempts",
          },
        }),
      ).toThrowError(/STEALTH_VERIFICATION_MAX_ATTEMPTS/);
    });
  });

  describe("Table-driven per-field schema bounds validation", () => {
    interface BoundTestCase {
      name: string;
      envVar: string;
      invalidValue: string | number;
      validValue: string | number;
      expectedErrorPattern: RegExp;
    }

    const testCases: BoundTestCase[] = [
      {
        name: "attempts >= 1 (STEALTH_VERIFICATION_MAX_ATTEMPTS rejects 0)",
        envVar: "STEALTH_VERIFICATION_MAX_ATTEMPTS",
        invalidValue: "0",
        validValue: "1",
        expectedErrorPattern: /maxAttempts|at least 1/,
      },
      {
        name: "skew >= 0 (STEALTH_AUTH_CLOCK_SKEW_MS rejects negative skew)",
        envVar: "STEALTH_AUTH_CLOCK_SKEW_MS",
        invalidValue: "-1",
        validValue: "0",
        expectedErrorPattern: /authClockSkewMs|non-negative/,
      },
      {
        name: "timeouts >= 100 ms (STEALTH_RELAY_TIMEOUT_MS rejects < 100ms)",
        envVar: "STEALTH_RELAY_TIMEOUT_MS",
        invalidValue: "99",
        validValue: "100",
        expectedErrorPattern: /relayTimeoutMs|at least 100 ms/,
      },
      {
        name: "TTLs >= 60 s (STEALTH_AUTH_CHALLENGE_LIFETIME_MS rejects < 60000ms)",
        envVar: "STEALTH_AUTH_CHALLENGE_LIFETIME_MS",
        invalidValue: "59999",
        validValue: "60000",
        expectedErrorPattern: /authChallengeLifetimeMs|at least 60s/,
      },
      {
        name: "TTLs >= 60 s (STEALTH_AUTH_NONCE_TTL_MS rejects < 60000ms)",
        envVar: "STEALTH_AUTH_NONCE_TTL_MS",
        invalidValue: "59999",
        validValue: "60000",
        expectedErrorPattern: /authNonceTtlMs|at least 60s/,
      },
      {
        name: "TTLs >= 60 s (STEALTH_QUOTE_LIFETIME_MS rejects < 60000ms)",
        envVar: "STEALTH_QUOTE_LIFETIME_MS",
        invalidValue: "59999",
        validValue: "60000",
        expectedErrorPattern: /quoteLifetimeMs|at least 60s/,
      },
      {
        name: "TTLs >= 60 s (STEALTH_VERIFICATION_TOKEN_LIFETIME_MS rejects < 60000ms)",
        envVar: "STEALTH_VERIFICATION_TOKEN_LIFETIME_MS",
        invalidValue: "59999",
        validValue: "60000",
        expectedErrorPattern: /tokenLifetimeMs|at least 60s/,
      },
    ];

    testCases.forEach(({ name, envVar, invalidValue, validValue, expectedErrorPattern }) => {
      it(`enforces bound for ${name}`, () => {
        // Invalid bound fails
        expect(() =>
          loadRuntimeConfig({
            profile: "development",
            env: { [envVar]: String(invalidValue) },
          }),
        ).toThrowError(expectedErrorPattern);

        // Valid bound succeeds
        const config = loadRuntimeConfig({
          profile: "development",
          env: { [envVar]: String(validValue) },
        });
        expect(config).toBeDefined();
      });
    });
  });
});
