import { describe, expect, it, vi } from "vitest";
import server, { isHostAllowed, resolveAllowedHosts, resolveFederationServerUrl } from "../../../src/server";
import { loadRuntimeConfig } from "../../../src/config";

vi.mock("../../../src/config/registry", () => ({
  validateRegistryDrift: vi.fn(),
}));

vi.mock("@tanstack/react-start/server-entry", () => ({
  default: {
    fetch: vi.fn(async () => new Response("OK from handler", { status: 200 })),
  },
}));

describe("BETA-082 / Issue #528: Server Host Header validation and canonical redirects", () => {
  const prodEnv = {
    STEALTH_ENV: "production",
    STEALTH_APP_URL: "https://app.betasmail.com",
    STEALTH_CURSOR_SECRET: "valid-secret-key-32-chars-length",
    STEALTH_KV_NAMESPACE_ID: "prod-kv",
    STEALTH_REGISTRY_CONTRACT_ID: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    STEALTH_POSTAGE_CONTRACT_ID: "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    STEALTH_CORS_ALLOWED_ORIGINS: "https://app.betasmail.com",
    STEALTH_SMTP_PASSWORD: "valid",
    STEALTH_RELAY_API_KEY: "valid",
    STEALTH_STORAGE_SECRET: "valid",
    STEALTH_RPC_API_KEY: "valid",
    STEALTH_OPERATOR_SECRET: "valid",
  };

  const previewEnv = {
    STEALTH_ENV: "preview",
    STEALTH_APP_URL: "https://app-preview.betasmail.com",
    STEALTH_CURSOR_SECRET: "valid-secret-key-32-chars-length",
    STEALTH_KV_NAMESPACE_ID: "preview-kv",
    STEALTH_REGISTRY_CONTRACT_ID: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    STEALTH_POSTAGE_CONTRACT_ID: "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    STEALTH_CORS_ALLOWED_ORIGINS: "https://app-preview.betasmail.com",
    STEALTH_SMTP_PASSWORD: "valid",
    STEALTH_RELAY_API_KEY: "valid",
    STEALTH_STORAGE_SECRET: "valid",
    STEALTH_RPC_API_KEY: "valid",
    STEALTH_OPERATOR_SECRET: "valid",
  };

  describe("Host allowlist checks (isHostAllowed)", () => {
    it("allows canonical host, www/apex root domains, and configured origins", () => {
      const config = loadRuntimeConfig({ profile: "production", env: prodEnv });
      expect(isHostAllowed("app.betasmail.com", config)).toBe(true);
      expect(isHostAllowed("app.betasmail.com:443", config)).toBe(true);
      expect(isHostAllowed("betasmail.com", config)).toBe(true);
      expect(isHostAllowed("www.betasmail.com", config)).toBe(true);
    });

    it("rejects untrusted or forged Host headers like evil.example", () => {
      const config = loadRuntimeConfig({ profile: "production", env: prodEnv });
      expect(isHostAllowed("evil.example", config)).toBe(false);
      expect(isHostAllowed("evil.example:443", config)).toBe(false);
      expect(isHostAllowed("attacker.com", config)).toBe(false);
      expect(isHostAllowed("", config)).toBe(false);
      expect(isHostAllowed(null, config)).toBe(false);
    });

    it("allows localhost and 127.0.0.1 in development or test profile", () => {
      const devConfig = loadRuntimeConfig({ profile: "development" });
      expect(isHostAllowed("localhost", devConfig)).toBe(true);
      expect(isHostAllowed("localhost:3000", devConfig)).toBe(true);
      expect(isHostAllowed("127.0.0.1:5173", devConfig)).toBe(true);
      expect(isHostAllowed("evil.example", devConfig)).toBe(false);
    });
  });

  describe("Environment identity and Federation URL derivation", () => {
    it("derives federation URL from config profile, never caller host string", () => {
      const prodConfig = loadRuntimeConfig({ profile: "production", env: prodEnv });
      expect(resolveFederationServerUrl(prodConfig)).toBe(
        "https://app.betasmail.com/api/v1/federation",
      );

      const prevConfig = loadRuntimeConfig({ profile: "preview", env: previewEnv });
      expect(resolveFederationServerUrl(prevConfig)).toBe(
        "https://app-preview.betasmail.com/api/v1/federation",
      );

      const devConfig = loadRuntimeConfig({ profile: "development" });
      expect(resolveFederationServerUrl(devConfig)).toBe(
        "http://localhost:3000/api/v1/federation",
      );
    });
  });

  describe("server.fetch request routing and protection", () => {
    it("rejects forged Host: evil.example with 400 Bad Request before routing", async () => {
      const req = new Request("http://evil.example/any/route", {
        headers: { host: "evil.example" },
      });

      const res = await server.fetch(req, prodEnv as any);
      expect(res.status).toBe(400);
      const text = await res.text();
      expect(text).toContain("Invalid Host header");
    });

    it("never reflects evil.example in Location during HTTP-to-HTTPS redirect", async () => {
      const req = new Request("http://evil.example/mail/inbox?page=2", {
        headers: {
          host: "evil.example",
          "x-forwarded-proto": "http",
        },
      });

      const res = await server.fetch(req, prodEnv as any);
      // Fails fast at host validation with 400
      expect(res.status).toBe(400);
      expect(res.headers.get("Location")).toBeNull();
    });

    it("redirects legitimate HTTP requests to canonical origin, not caller host", async () => {
      const req = new Request("http://app.betasmail.com/mail/inbox?page=2", {
        headers: {
          host: "app.betasmail.com",
          "x-forwarded-proto": "http",
        },
      });

      const res = await server.fetch(req, prodEnv as any);
      expect(res.status).toBe(301);
      expect(res.headers.get("Location")).toBe("https://app.betasmail.com/mail/inbox?page=2");
    });

    it("serves /.well-known/stellar.toml with configured canonical federation URL", async () => {
      const req = new Request("https://app.betasmail.com/.well-known/stellar.toml", {
        headers: { host: "app.betasmail.com" },
      });

      const res = await server.fetch(req, prodEnv as any);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain('FEDERATION_SERVER="https://app.betasmail.com/api/v1/federation"');
      expect(body).not.toContain("evil.example");
    });

    it("rejects forged Host on /.well-known/stellar.toml and never returns TOML for evil host", async () => {
      const req = new Request("https://evil.example/.well-known/stellar.toml", {
        headers: { host: "evil.example" },
      });

      const res = await server.fetch(req, prodEnv as any);
      expect(res.status).toBe(400);
      const body = await res.text();
      expect(body).not.toContain("FEDERATION_SERVER");
      expect(body).toContain("Invalid Host header");
    });

    it("redirects root domains (betasmail.com) to canonical origin", async () => {
      const req = new Request("https://betasmail.com/welcome", {
        headers: { host: "betasmail.com" },
      });

      const res = await server.fetch(req, prodEnv as any);
      expect(res.status).toBe(301);
      expect(res.headers.get("Location")).toBe("https://app.betasmail.com/welcome");
    });
  });
});
