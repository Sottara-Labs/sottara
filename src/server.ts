import handler from "@tanstack/react-start/server-entry";

import { handleApiRequest } from "./server/api/response";
import { getApiContext, getObjectStore } from "./server/api/context";
import { enforceRetention } from "./server/api/retention-service";
import { applySecurityHeaders } from "./server/security/headers";
import { processVerificationMailQueue } from "./services/notifications/worker";

export { StealthCoordinator } from "./server/api/stealth-coordinator";

const DEFAULT_ALLOWED_HOSTS = new Set([
  "betasmail.com",
  "www.betasmail.com",
  "app.betasmail.com",
  "app-preview.betasmail.com",
  "localhost",
  "127.0.0.1",
]);

function isAllowedHost(host: string, env: Record<string, string | undefined>): boolean {
  const hostWithoutPort = host.split(":")[0].toLowerCase();
  if (
    DEFAULT_ALLOWED_HOSTS.has(host.toLowerCase()) ||
    DEFAULT_ALLOWED_HOSTS.has(hostWithoutPort) ||
    hostWithoutPort === "localhost" ||
    hostWithoutPort === "127.0.0.1"
  ) {
    return true;
  }
  if (env.STEALTH_APP_URL) {
    try {
      const parsed = new URL(env.STEALTH_APP_URL);
      if (
        parsed.host.toLowerCase() === host.toLowerCase() ||
        parsed.hostname.toLowerCase() === hostWithoutPort
      ) {
        return true;
      }
    } catch {
      // Ignore invalid URL
    }
  }
  if (env.STEALTH_CORS_ALLOWED_ORIGINS) {
    const origins = env.STEALTH_CORS_ALLOWED_ORIGINS.split(",").map((s) => s.trim());
    for (const origin of origins) {
      try {
        const parsed = new URL(origin);
        if (
          parsed.host.toLowerCase() === host.toLowerCase() ||
          parsed.hostname.toLowerCase() === hostWithoutPort
        ) {
          return true;
        }
      } catch {
        // Ignore
      }
    }
  }
  return false;
}

function getCanonicalOrigin(env: Record<string, string | undefined>): string {
  if (env.STEALTH_APP_URL) {
    return env.STEALTH_APP_URL.replace(/\/+$/, "");
  }
  const profile = env.STEALTH_ENV ?? env.NODE_ENV;
  if (profile === "preview" || profile === "staging") {
    return "https://app-preview.betasmail.com";
  }
  return "https://app.betasmail.com";
}

export default {
  async fetch(...args: Parameters<typeof handler.fetch>) {
    const [request] = args;
    const env =
      (args[1] as Record<string, string | undefined>) ??
      (typeof process !== "undefined" ? process.env : {});
    const url = new URL(request.url);
    const host = request.headers.get("host") || url.host;

    // Validate Host header against explicit allowlist before routing
    if (!isAllowedHost(host, env)) {
      return applySecurityHeaders(
        new Response("Invalid Host header", {
          status: 400,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
          },
        }),
      );
    }

    const canonicalOrigin = getCanonicalOrigin(env);

    // 1. HTTP to HTTPS redirect in production-like envs (Cloudflare x-forwarded-proto)
    const proto = request.headers.get("x-forwarded-proto");
    const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
    if (proto === "http" && !isLocal) {
      return applySecurityHeaders(
        new Response(null, {
          status: 301,
          headers: {
            Location: `${canonicalOrigin}${url.pathname}${url.search}`,
          },
        }),
      );
    }

    // 2. Intercept and serve SEP-1 stellar.toml dynamically
    if (url.pathname === "/.well-known/stellar.toml") {
      const fedServer = `${canonicalOrigin}/api/v1/federation`;
      const tomlContent = [
        `# Stellar TOML Configuration for Hush Mail`,
        `FEDERATION_SERVER="${fedServer}"`,
      ].join("\n");

      return applySecurityHeaders(
        new Response(tomlContent, {
          status: 200,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
          },
        }),
      );
    }

    // 3. Root domain redirect (betasmail.com -> app.betasmail.com)
    if (host === "betasmail.com" || host === "www.betasmail.com") {
      return applySecurityHeaders(
        new Response(null, {
          status: 301,
          headers: {
            Location: `${canonicalOrigin}${url.pathname}${url.search}`,
          },
        }),
      );
    }

    // 4. Default API options and request handling
    let response: Response;
    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      response = await handleApiRequest(request, () => handler.fetch(...args));
    } else {
      response = await handler.fetch(...args);
    }
    return applySecurityHeaders(response);
  },
  async scheduled(controller: { scheduledTime: number }) {
    const context = await getApiContext();
    await enforceRetention(
      context.repository,
      await getObjectStore(),
      new Date(controller.scheduledTime),
    );
    // BETA-091: drain deferred verification-mail retries (backoff / bounce path).
    await processVerificationMailQueue();
  },
};
