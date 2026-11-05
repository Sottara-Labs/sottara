import handler from "@tanstack/react-start/server-entry";

import { handleApiRequest } from "./server/api/response";
import { getApiContext, getObjectStore } from "./server/api/context";
import { enforceRetention } from "./server/api/retention-service";
import { applySecurityHeaders } from "./server/security/headers";
import { processVerificationMailQueue } from "./services/notifications/worker";

import { loadRuntimeConfig, type BetaRuntimeConfig } from "./config";

export { StealthCoordinator } from "./server/api/stealth-coordinator";

export function resolveAllowedHosts(config: BetaRuntimeConfig): Set<string> {
  const allowed = new Set<string>();
  try {
    const canonical = new URL(config.origin.appUrl);
    allowed.add(canonical.host.toLowerCase());
    allowed.add(canonical.hostname.toLowerCase());
  } catch {
    allowed.add("app.betasmail.com");
  }

  for (const origin of config.origin.allowedOrigins) {
    try {
      const u = new URL(origin);
      allowed.add(u.host.toLowerCase());
      allowed.add(u.hostname.toLowerCase());
    } catch {
      // ignore malformed origin entries
    }
  }

  // Canonical root domains supported for redirection
  allowed.add("betasmail.com");
  allowed.add("www.betasmail.com");

  if (config.profile === "development" || config.profile === "test") {
    allowed.add("localhost");
    allowed.add("127.0.0.1");
  }

  return allowed;
}

export function isHostAllowed(hostHeader: string | null | undefined, config: BetaRuntimeConfig): boolean {
  if (!hostHeader) return false;
  const clean = hostHeader.trim().toLowerCase();
  if (!clean) return false;
  const hostname = clean.includes(":") ? clean.split(":")[0] : clean;
  const allowed = resolveAllowedHosts(config);

  if (allowed.has(clean) || allowed.has(hostname)) {
    return true;
  }

  if ((config.profile === "development" || config.profile === "test") &&
      (hostname === "localhost" || hostname === "127.0.0.1")) {
    return true;
  }

  return false;
}

export function resolveFederationServerUrl(config: BetaRuntimeConfig): string {
  if (config.profile === "preview") {
    return config.origin.appUrl.includes("preview")
      ? `${config.origin.appUrl.replace(/\/$/, "")}/api/v1/federation`
      : "https://app-preview.betasmail.com/api/v1/federation";
  }
  return `${config.origin.appUrl.replace(/\/$/, "")}/api/v1/federation`;
}

export default {
  async fetch(...args: Parameters<typeof handler.fetch>) {
    const [request, env] = args;
    const url = new URL(request.url);
    const host = request.headers.get("host") || url.host;

    let config: BetaRuntimeConfig;
    try {
      config = loadRuntimeConfig(
        env && typeof env === "object" ? { env: env as Record<string, string | undefined> } : undefined,
      );
    } catch {
      config = loadRuntimeConfig({ profile: "development" });
    }

    // Reject requests whose Host is not in an explicit allowlist before routing
    if (!isHostAllowed(host, config)) {
      return applySecurityHeaders(
        new Response("Invalid Host header", { status: 400 }),
      );
    }

    let canonicalUrl: URL;
    try {
      canonicalUrl = new URL(config.origin.appUrl);
    } catch {
      canonicalUrl = new URL("https://app.betasmail.com");
    }

    // 1. HTTP to HTTPS redirect in production-like envs (Cloudflare x-forwarded-proto)
    const proto = request.headers.get("x-forwarded-proto");
    const isDev = config.profile === "development" || config.profile === "test";
    if (proto === "http" && !isDev) {
      return applySecurityHeaders(
        new Response(null, {
          status: 301,
          headers: {
            Location: `${canonicalUrl.origin}${url.pathname}${url.search}`,
          },
        }),
      );
    }

    // 2. Intercept and serve SEP-1 stellar.toml dynamically
    if (url.pathname === "/.well-known/stellar.toml") {
      const fedServer = resolveFederationServerUrl(config);

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
    const hostname = host.includes(":") ? host.split(":")[0] : host;
    if (hostname === "betasmail.com" || hostname === "www.betasmail.com") {
      return applySecurityHeaders(
        new Response(null, {
          status: 301,
          headers: {
            Location: `${canonicalUrl.origin}${url.pathname}${url.search}`,
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
