import { describe, expect, it, vi } from "vitest";
import {
  formatConfigMatrix,
  getPublicConfig,
  getRedactedConfig,
  loadRuntimeConfig,
  parseNumber,
} from "../../../src/config";

vi.mock("../../../src/config/registry", () => ({
  validateRegistryDrift: vi.fn(),
}));

describe("BETA-001 :: Beta Runtime Configuration Contract", () => {
  const baseProdEnv = {
    STEALTH_CURSOR_SECRET: "prod-secret-key-32-chars-long-valid",
    STEALTH_SMTP_PASSWORD: "valid",
    STEALTH_RELAY_API_KEY: "valid",
    STEALTH_STORAGE_SECRET: "valid",
    STEALTH_RPC_API_KEY: "valid",
    STEALTH_OPERATOR_SECRET: "valid",
    STEALTH_KV_NAMESPACE_ID: "stealth-kv-beta-prod-id",
    STEALTH_REGISTRY_CONTRACT_ID: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    STEALTH_POSTAGE_CONTRACT_ID: "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    STEALTH_APP_URL: "https://app.betasmail.com",
    STEALTH_CORS_ALLOWED_ORIGINS: "https://app.betasmail.com",
  };

  describe("Profile Loading & Defaults", () => {
    it("loads development profile with sensible local defaults", () => {
      const config = loadRuntimeConfig({ profile: "development" });

      expect(config.profile).toBe("development");
      expect(config.network.stellarNetwork).toBe("testnet");
      expect(config.network.horizonUrl).toBe("https://horizon-testnet.stellar.org");
      expect(config.network.sorobanRpcUrl).toBe("https://soroban-testnet.stellar.org");
      expect(config.storage.storageDriver).toBe("memory");
      expect(config.storage.kvNamespaceId).toBe("stealth-kv-dev");
      expect(config.secrets.cursorSecret).toBe("dev-cursor-secret-change-me");
      expect(config.relay.relayUrl).toBe("https://relay-testnet.betasmail.com");
      expect(config.contract.domainTag).toBe("Stealth_Mail_Protocol");
      expect(config.contract.protocolVersion).toBe("v1");
      expect(config.contract.policiesContractId).toBe("C".repeat(56));
      expect(config.origin.appUrl).toBe("http://localhost:3000");
    });

    it("loads test profile", () => {
      const config = loadRuntimeConfig({ profile: "test" });
      expect(config.profile).toBe("test");
    });

    it("loads preview profile", () => {
      const config = loadRuntimeConfig({ profile: "preview" });
      expect(config.profile).toBe("preview");
      expect(config.storage.storageDriver).toBe("hybrid");
      expect(config.storage.kvNamespaceId).toBe("stealth-kv-beta-preview");
    });

    it("loads production profile with a valid configuration", () => {
      const validProdEnv = {
        STEALTH_ENV: "production",
        STEALTH_CURSOR_SECRET: "prod-secret-key-32-chars-long-valid",
        STEALTH_KV_NAMESPACE_ID: "stealth-kv-beta-prod-id",
        STEALTH_REGISTRY_CONTRACT_ID: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        STEALTH_POSTAGE_CONTRACT_ID: "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        STEALTH_APP_URL: "https://app.betasmail.com",
        STEALTH_CORS_ALLOWED_ORIGINS: "https://app.betasmail.com",
        STEALTH_SMTP_PASSWORD: "valid",
        STEALTH_RELAY_API_KEY: "valid",
        STEALTH_STORAGE_SECRET: "valid",
        STEALTH_RPC_API_KEY: "valid",
        STEALTH_OPERATOR_SECRET: "valid",
      };

      const config = loadRuntimeConfig({
        profile: "production",
        env: validProdEnv,
      });

      expect(config.profile).toBe("production");
      expect(config.network.stellarNetwork).toBe("mainnet");
      expect(config.network.horizonUrl).toBe("https://horizon.stellar.org");
      expect(config.storage.kvNamespaceId).toBe("stealth-kv-beta-prod-id");
      expect(config.secrets.cursorSecret).toBe("prod-secret-key-32-chars-long-valid");
      expect(config.origin.appUrl).toBe("https://app.betasmail.com");
    });
  });

  describe("Production Failure Gates & Boundary Checks", () => {
    it("fails production startup when STEALTH_CURSOR_SECRET is missing or empty", () => {
      expect(() =>
        loadRuntimeConfig({
          profile: "production",
          env: {
            ...baseProdEnv,
            STEALTH_CURSOR_SECRET: "",
          },
        }),
      ).toThrow(/STEALTH_CURSOR_SECRET is required/);
    });

    it("fails production startup when STEALTH_CURSOR_SECRET is a placeholder", () => {
      expect(() =>
        loadRuntimeConfig({
          profile: "production",
          env: {
            ...baseProdEnv,
            STEALTH_CURSOR_SECRET: "dev-cursor-secret-change-me",
          },
        }),
      ).toThrow(/STEALTH_CURSOR_SECRET is required and must not be a default\/placeholder/);
    });

    it("fails production startup when STEALTH_KV_NAMESPACE_ID is a placeholder", () => {
      expect(() =>
        loadRuntimeConfig({
          profile: "production",
          env: {
            ...baseProdEnv,
            STEALTH_KV_NAMESPACE_ID: "placeholder-prod-id",
          },
        }),
      ).toThrow(/STEALTH_KV_NAMESPACE_ID must be configured and cannot be a placeholder/);
    });

    it("fails production startup when STEALTH_REGISTRY_CONTRACT_ID is a placeholder", () => {
      expect(() =>
        loadRuntimeConfig({
          profile: "production",
          env: {
            ...baseProdEnv,
            STEALTH_REGISTRY_CONTRACT_ID: "C_REGISTRY_PLACEHOLDER",
          },
        }),
      ).toThrow(/STEALTH_REGISTRY_CONTRACT_ID is required and cannot be a placeholder/);
    });

    it("fails production startup when STEALTH_POLICIES_CONTRACT_ID is a placeholder", () => {
      expect(() =>
        loadRuntimeConfig({
          profile: "production",
          env: {
            ...baseProdEnv,
            STEALTH_POLICIES_CONTRACT_ID: "C_POLICIES_PLACEHOLDER",
          },
        }),
      ).toThrow(/STEALTH_POLICIES_CONTRACT_ID is required and cannot be a placeholder/);
    });

    it("fails production startup when STEALTH_APP_URL is localhost", () => {
      expect(() =>
        loadRuntimeConfig({
          profile: "production",
          env: {
            ...baseProdEnv,
            STEALTH_APP_URL: "http://localhost:3000",
          },
        }),
      ).toThrow(/STEALTH_APP_URL must be a valid public origin/);
    });

    it("fails production startup when CORS origins contain a wildcard", () => {
      expect(() =>
        loadRuntimeConfig({
          profile: "production",
          env: {
            ...baseProdEnv,
            STEALTH_CORS_ALLOWED_ORIGINS: "*",
          },
        }),
      ).toThrow(/STEALTH_CORS_ALLOWED_ORIGINS must contain explicit origin URLs/);
    });
  });

  describe("Public/Secret Separation & Redaction Safety", () => {
    it("getPublicConfig strips secret parameters completely", () => {
      const config = loadRuntimeConfig({
        profile: "development",
        env: {
          STEALTH_CURSOR_SECRET: "super-secret-key",
          STEALTH_RELAY_API_KEY: "secret-relay-token",
        },
      });

      const publicConfig = getPublicConfig(config);

      expect((publicConfig as any).secrets).toBeUndefined();
      expect((publicConfig as any).relay.relayApiKey).toBeUndefined();
      expect(publicConfig.network.horizonUrl).toBe("https://horizon-testnet.stellar.org");
    });

    it("getRedactedConfig replaces secret values with [REDACTED]", () => {
      const config = loadRuntimeConfig({
        profile: "development",
        env: {
          STEALTH_CURSOR_SECRET: "super-secret-key",
          STEALTH_RELAY_API_KEY: "secret-relay-token",
        },
      });

      const redacted = getRedactedConfig(config) as any;

      expect(redacted.secrets.hasCursorSecret).toBe(true);
      expect(redacted.secrets.hasRelayApiKey).toBe(true);
      expect(redacted.secrets.hasStorageSecret).toBe(false);
    });

    it("never leaks actual secret values in error messages", () => {
      const sensitiveSecret = "my-ultra-secret-value-12345";
      let errorMessage = "";

      try {
        loadRuntimeConfig({
          profile: "production",
          env: {
            ...baseProdEnv,
            STEALTH_CURSOR_SECRET: sensitiveSecret,
            STEALTH_KV_NAMESPACE_ID: "placeholder-prod-id", // triggers failure
          },
        });
      } catch (err) {
        errorMessage = (err as Error).message;
      }

      expect(errorMessage).not.toContain(sensitiveSecret);
    });
  });

  describe("Config Matrix Formatting", () => {
    it("formatConfigMatrix outputs all 6 domain sections with redacted secrets", () => {
      const config = loadRuntimeConfig({
        profile: "development",
        env: {
          STEALTH_CURSOR_SECRET: "secret-123",
          STEALTH_RELAY_API_KEY: "api-key-456",
        },
      });

      const matrix = formatConfigMatrix(config);

      expect(matrix).toContain("=== Hush Mail Beta Runtime Configuration Matrix ===");
      expect(matrix).toContain("[Network]");
      expect(matrix).toContain("[Storage]");
      expect(matrix).toContain("[Session & Security]");
      expect(matrix).toContain("[Relay]");
      expect(matrix).toContain("[Contract]");
      expect(matrix).toContain("[Origin & CORS]");
      expect(matrix).toContain("[Secrets (Redacted)]");
      expect(matrix).toContain("Cursor Secret:         [CONFIGURED]");
      expect(matrix).toContain("Relay API Key:         [CONFIGURED]");
      expect(matrix).not.toContain("secret-123");
      expect(matrix).not.toContain("api-key-456");
    });
  });

  describe("Numeric Setting Parsing & Per-Field Bounds (Issue #529)", () => {
    it("parses valid decimal integers strictly and rejects malformed values naming the variable", () => {
      expect(parseNumber("300000", 100, "STEALTH_TEST")).toBe(300000);
      expect(parseNumber("-42", 100, "STEALTH_TEST")).toBe(-42);
      expect(parseNumber("0", 100, "STEALTH_TEST")).toBe(0);
      expect(parseNumber(12345, 100, "STEALTH_TEST")).toBe(12345);
      expect(parseNumber("", 100, "STEALTH_TEST")).toBe(100);
      expect(parseNumber(undefined, 100, "STEALTH_TEST")).toBe(100);
      expect(parseNumber(null, 100, "STEALTH_TEST")).toBe(100);

      const malformedCases = ["300000abc", "1e5", "0x10", "300.5", "abc", "12 34"];
      for (const val of malformedCases) {
        expect(() => parseNumber(val, 100, "STEALTH_TEST_VAR")).toThrow(
          /STEALTH_TEST_VAR.*valid integer/,
        );
      }
    });

    it("fails fast naming the variable when given malformed numeric strings like 300000abc", () => {
      expect(() =>
        loadRuntimeConfig({
          profile: "development",
          env: { STEALTH_AUTH_CHALLENGE_LIFETIME_MS: "300000abc" },
        }),
      ).toThrow(/STEALTH_AUTH_CHALLENGE_LIFETIME_MS/);

      expect(() =>
        loadRuntimeConfig({
          profile: "development",
          env: { STEALTH_RELAY_TIMEOUT_MS: "10000xyz" },
        }),
      ).toThrow(/STEALTH_RELAY_TIMEOUT_MS/);

      expect(() =>
        loadRuntimeConfig({
          profile: "development",
          env: { STEALTH_VERIFICATION_MAX_ATTEMPTS: "5foo" },
        }),
      ).toThrow(/STEALTH_VERIFICATION_MAX_ATTEMPTS/);
    });

    it("rejects 0 for max attempts and negative clock skew", () => {
      expect(() =>
        loadRuntimeConfig({
          profile: "development",
          env: { STEALTH_VERIFICATION_MAX_ATTEMPTS: "0" },
        }),
      ).toThrow(/maxAttempts|verification/i);

      expect(() =>
        loadRuntimeConfig({
          profile: "development",
          env: { STEALTH_AUTH_CLOCK_SKEW_MS: "-1" },
        }),
      ).toThrow(/authClockSkewMs|clock skew/i);
    });

    describe("Table-driven per-field bounds", () => {
      const boundCases = [
        // Attempts >= 1
        {
          field: "STEALTH_VERIFICATION_MAX_ATTEMPTS",
          invalid: ["0", "-1"],
          valid: ["1", "5"],
          desc: "attempts ≥ 1",
        },
        // Timeouts >= 100 ms
        {
          field: "STEALTH_RELAY_TIMEOUT_MS",
          invalid: ["99", "0", "-50"],
          valid: ["100", "5000"],
          desc: "timeouts ≥ 100 ms",
        },
        // Skew >= 0
        {
          field: "STEALTH_AUTH_CLOCK_SKEW_MS",
          invalid: ["-1", "-30000"],
          valid: ["0", "30000"],
          desc: "skew ≥ 0",
        },
        // TTLs >= 60 s (60,000 ms)
        {
          field: "STEALTH_AUTH_CHALLENGE_LIFETIME_MS",
          invalid: ["59999", "0", "-1"],
          valid: ["60000", "300000"],
          desc: "auth challenge lifetime TTL ≥ 60 s",
        },
        {
          field: "STEALTH_AUTH_NONCE_TTL_MS",
          invalid: ["59999", "0", "-1"],
          valid: ["60000", "300000"],
          desc: "auth nonce TTL ≥ 60 s",
        },
        {
          field: "STEALTH_QUOTE_LIFETIME_MS",
          invalid: ["59999", "0", "-1"],
          valid: ["60000", "300000"],
          desc: "quote lifetime TTL ≥ 60 s",
        },
        {
          field: "STEALTH_VERIFICATION_TOKEN_LIFETIME_MS",
          invalid: ["59999", "0", "-1"],
          valid: ["60000", "86400000"],
          desc: "verification token lifetime TTL ≥ 60 s",
        },
      ];

      for (const { field, invalid, valid, desc } of boundCases) {
        describe(`${field} (${desc})`, () => {
          for (const val of invalid) {
            it(`rejects invalid value: "${val}"`, () => {
              expect(() =>
                loadRuntimeConfig({
                  profile: "development",
                  env: { [field]: val },
                }),
              ).toThrow();
            });
          }

          for (const val of valid) {
            it(`accepts valid bound value: "${val}"`, () => {
              expect(() =>
                loadRuntimeConfig({
                  profile: "development",
                  env: { [field]: val },
                }),
              ).not.toThrow();
            });
          }
        });
      }
    });
  });
});
