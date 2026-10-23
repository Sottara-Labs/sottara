import { afterEach, describe, expect, it, vi } from "vitest";

import { Route as HealthRoute } from "../../../src/routes/api/v1/health";
import { corsPolicyFromEnv, csrfEarlyResponse } from "../../../src/server/api/cors";
import serverEntry from "../../../src/server";
import { loadRuntimeConfig } from "../../../src/config";

const healthHandler = (HealthRoute.options as any).server?.handlers?.GET;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("API route CORS integration", () => {
  it("allows every local development port but keeps production restricted", () => {
    const development = corsPolicyFromEnv({ STEALTH_ENV: "development" });
    for (const host of ["localhost", "127.0.0.1"]) {
      for (const port of [3000, 5173, 8080]) {
        expect(development.allowedOrigins).toContain(`http://${host}:${port}`);
      }
    }
    expect(
      corsPolicyFromEnv({
        STEALTH_ENV: "production",
        STEALTH_CORS_ALLOWED_ORIGINS: "http://localhost:8080,https://attacker.example",
      }).allowedOrigins,
    ).toEqual(["https://app.betasmail.com"]);
  });
  it("rejects a disallowed origin before executing an actual API route", async () => {
    const response = await healthHandler({
      request: new Request("http://localhost/api/v1/health", {
        headers: { Origin: "https://attacker.example" },
      }),
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("rejects a cookie-bearing state change without browser origin context", async () => {
    const response = csrfEarlyResponse(
      new Request("https://app.stealth.mail/api/v1/health", {
        method: "POST",
        headers: { cookie: "stealth_session=redacted" },
      }),
      corsPolicyFromEnv({
        STEALTH_ENV: "production",
        STEALTH_CORS_ALLOWED_ORIGINS: "https://app.stealth.mail",
      }),
    );

    expect(response?.status).toBe(403);
  });

  it("rejects a disallowed origin outside explicit development", () => {
    vi.stubEnv("STEALTH_ENV", "preview");
    const policy = corsPolicyFromEnv({
      STEALTH_ENV: "preview",
      STEALTH_CORS_ALLOWED_ORIGINS: "https://app.betasmail.com",
    });

    const response = csrfEarlyResponse(
      new Request("https://app.betasmail.com/api/v1/profile", {
        method: "POST",
        headers: {
          cookie: "stealth_session=redacted",
          Origin: "https://attacker.example",
        },
      }),
      policy,
    );

    expect(response?.status).toBe(403);
  });

  it("keeps the guard bypass for explicit development requests", () => {
    vi.stubEnv("STEALTH_ENV", "development");
    const policy = corsPolicyFromEnv({ STEALTH_ENV: "development" });

    const response = csrfEarlyResponse(
      new Request("http://localhost:3000/api/v1/profile", {
        method: "POST",
        headers: { cookie: "stealth_session=redacted" },
      }),
      policy,
    );

    expect(response).toBeUndefined();
  });

  it("passes preflight with Origin: https://app.betasmail.com and a Worker-shaped env with bindings only", async () => {
    const request = new Request("https://app.betasmail.com/api/v1/health", {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.betasmail.com",
        "Access-Control-Request-Method": "GET",
      },
    });

    const bindings = {
      STEALTH_ENV: "production",
      STEALTH_APP_URL: "https://app.betasmail.com",
    };

    const response = await serverEntry.fetch(request, bindings);
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.betasmail.com");
  });

  it("does not advertise localhost origins in production preflight", async () => {
    const request = new Request("https://app.betasmail.com/api/v1/health", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "GET",
      },
    });

    const bindings = {
      STEALTH_ENV: "production",
      STEALTH_APP_URL: "https://app.betasmail.com",
    };

    const response = await serverEntry.fetch(request, bindings);
    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("constructs the handler with bindings only without requiring process.env", async () => {
    const request = new Request("https://app.betasmail.com/api/v1/health", {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.betasmail.com",
        "Access-Control-Request-Method": "POST",
      },
    });

    const response = await serverEntry.fetch(request, {
      STEALTH_ENV: "production",
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.betasmail.com");
  });

  it("fails closed when the profile is production but origins are still dev defaults", () => {
    expect(() =>
      loadRuntimeConfig({
        env: {
          STEALTH_ENV: "production",
          STEALTH_ROLE: "web",
          STEALTH_CURSOR_SECRET: "x".repeat(32),
          STEALTH_SMTP_PASSWORD: "valid-smtp-password",
          STEALTH_CORS_ALLOWED_ORIGINS: "http://localhost:3000,http://127.0.0.1:3000",
        },
      }),
    ).toThrow(
      /STEALTH_CORS_ALLOWED_ORIGINS cannot contain localhost or development origins in production/,
    );
  });

  it("derives the CSRF development exception from the validated profile parameter", () => {
    vi.stubEnv("STEALTH_ENV", "development");
    const prodPolicy = corsPolicyFromEnv({ STEALTH_ENV: "production" });

    const response = csrfEarlyResponse(
      new Request("https://app.betasmail.com/api/v1/profile", {
        method: "POST",
        headers: {
          cookie: "stealth_session=redacted",
          Origin: "https://evil.example",
        },
      }),
      prodPolicy,
      "production",
    );

    expect(response?.status).toBe(403);
  });
});
