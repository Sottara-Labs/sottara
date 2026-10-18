import type { BetaRuntimeConfig } from "../../config";

export type CorsPolicy = {
  allowedOrigins: readonly string[];
  allowedMethods: readonly string[];
  allowedHeaders: readonly string[];
  allowCredentials?: boolean;
  profile?: string;
};

const DEFAULT_ALLOWED_METHODS = [
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "OPTIONS",
  "HEAD",
  "PATCH",
] as const;
const DEFAULT_ALLOWED_HEADERS = [
  "Content-Type",
  "X-Idempotency-Key",
  "X-Request-Id",
  "X-Hush-Address",
] as const;

export const LOCAL_DEV_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
] as const;

function configuredList(value: string | undefined, fallback: readonly string[] = []): string[] {
  if (value === undefined) {
    return [...fallback];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function appendVary(headers: Headers, value: string) {
  const values = new Set(
    (headers.get("Vary") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  values.add(value);
  headers.set("Vary", [...values].join(", "));
}

export function validateCorsPolicy(policy: CorsPolicy, isProduction = false) {
  if (policy.allowedOrigins.includes("*")) {
    if (policy.allowCredentials) {
      throw new Error("Invalid CORS policy: wildcard origins cannot be combined with credentials.");
    }
    throw new Error("Invalid CORS policy: allowedOrigins must be an explicit origin allowlist.");
  }
  if (isProduction || policy.profile === "production") {
    const hasDev = policy.allowedOrigins.some(
      (origin) =>
        origin.includes("localhost") ||
        origin.includes("127.0.0.1") ||
        LOCAL_DEV_ORIGINS.includes(origin as any),
    );
    if (hasDev) {
      throw new Error("Invalid CORS policy: development origins are not permitted in production.");
    }
  }
}

export function corsPolicyFromConfig(config: BetaRuntimeConfig): CorsPolicy {
  const isProduction = config.profile === "production";
  const defaultOrigin = isProduction ? "https://app.betasmail.com" : config.origin.appUrl;

  let allowedOrigins = config.origin.allowedOrigins;
  if (isProduction) {
    // Fail closed: in production, never permit development or localhost origins
    const nonDev = allowedOrigins.filter(
      (origin) =>
        !origin.includes("localhost") &&
        !origin.includes("127.0.0.1") &&
        !LOCAL_DEV_ORIGINS.includes(origin as any),
    );
    allowedOrigins = nonDev.length > 0 ? nonDev : [defaultOrigin];
  }

  const policy: CorsPolicy = {
    allowedOrigins,
    allowedMethods: config.origin.allowedMethods,
    allowedHeaders: config.origin.allowedHeaders,
    allowCredentials: config.origin.allowCredentials,
    profile: config.profile,
  };
  validateCorsPolicy(policy, isProduction);
  return policy;
}

export function corsPolicyFromEnv(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): CorsPolicy {
  const isProduction =
    env.STEALTH_ENV === "production" ||
    (env.STEALTH_ENV === undefined && env.NODE_ENV === "production");
  const defaultOrigin = isProduction
    ? "https://app.betasmail.com"
    : (env.STEALTH_APP_URL ?? "http://localhost:3000");

  let allowedOrigins: string[];
  if (isProduction) {
    const configured = configuredList(env.STEALTH_CORS_ALLOWED_ORIGINS, [defaultOrigin]);
    // Fail closed: development origins are excluded in production
    const nonDev = configured.filter(
      (origin) =>
        !origin.includes("localhost") &&
        !origin.includes("127.0.0.1") &&
        !LOCAL_DEV_ORIGINS.includes(origin as any),
    );
    allowedOrigins =
      env.STEALTH_CORS_ALLOWED_ORIGINS && isProduction
        ? [defaultOrigin]
        : nonDev.length > 0
          ? nonDev
          : [defaultOrigin];
  } else {
    allowedOrigins = [
      ...new Set([
        ...configuredList(env.STEALTH_CORS_ALLOWED_ORIGINS, [defaultOrigin]),
        ...LOCAL_DEV_ORIGINS,
      ]),
    ];
  }

  const policy: CorsPolicy = {
    allowedOrigins,
    allowedMethods: configuredList(env.STEALTH_CORS_ALLOWED_METHODS, DEFAULT_ALLOWED_METHODS),
    allowedHeaders: configuredList(env.STEALTH_CORS_ALLOWED_HEADERS, DEFAULT_ALLOWED_HEADERS),
    allowCredentials: env.STEALTH_CORS_ALLOW_CREDENTIALS?.toLowerCase() !== "false",
    profile: isProduction ? "production" : (env.STEALTH_ENV ?? env.NODE_ENV ?? "development"),
  };
  validateCorsPolicy(policy, isProduction);
  return policy;
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isExplicitDevelopmentProfile(): boolean {
  const profile =
    typeof process !== "undefined"
      ? (process.env.STEALTH_ENV ?? process.env.SOTTARA_ENV ?? process.env.NODE_ENV)
      : undefined;
  return profile === "development" || profile === "dev";
}

function requestOrigin(request: Request): string | null {
  const origin = request.headers.get("Origin");
  if (origin !== null) return origin;

  const referer = request.headers.get("Referer");
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export function csrfEarlyResponse(
  request: Request,
  policy: CorsPolicy,
  profile?: string,
): Response | undefined {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return undefined;
  if (!request.headers.get("cookie")) return undefined;

  const effectiveProfile =
    profile ??
    policy.profile ??
    (typeof process !== "undefined"
      ? (process.env.STEALTH_ENV ?? process.env.SOTTARA_ENV ?? process.env.NODE_ENV)
      : undefined);

  // Localhost entries are present in non-production policies for browser
  // development. They must not disable CSRF protection for preview or test.
  const isDev = effectiveProfile === "development" || effectiveProfile === "dev";
  if (isDev) return undefined;

  const origin = requestOrigin(request);
  if (origin && policy.allowedOrigins.includes(origin)) return undefined;

  // SameSite=Lax is the primary browser defense; this closes clients that send
  // a session cookie without a trusted Origin/Referer context.
  const headers = new Headers();
  appendVary(headers, "Origin");
  return new Response(null, { status: 403, headers });
}

export const apiCorsPolicy = corsPolicyFromEnv();

export function corsEarlyResponse(request: Request, policy: CorsPolicy): Response | undefined {
  const url = new URL(request.url);
  const isFederation =
    url.pathname === "/api/v1/federation" || url.pathname === "/api/v1/federation/";

  const origin = request.headers.get("Origin");
  if (origin !== null && !isFederation && !policy.allowedOrigins.includes(origin)) {
    const headers = new Headers();
    appendVary(headers, "Origin");
    return new Response(null, { status: 403, headers });
  }

  if (request.method.toUpperCase() !== "OPTIONS") {
    return undefined;
  }

  if (isFederation) {
    const headers = new Headers({
      "Access-Control-Allow-Origin": origin ?? "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return new Response(null, { status: 204, headers });
  }

  if (origin === null) {
    return new Response(null, { status: 403 });
  }

  const requestedMethod = request.headers.get("Access-Control-Request-Method")?.toUpperCase();
  const allowedMethods = policy.allowedMethods.map((method) => method.toUpperCase());
  const requestedHeaders = (request.headers.get("Access-Control-Request-Headers") ?? "")
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  const allowedHeaderNames = new Set(policy.allowedHeaders.map((header) => header.toLowerCase()));

  if (
    !requestedMethod ||
    !allowedMethods.includes(requestedMethod) ||
    requestedHeaders.some((header) => !allowedHeaderNames.has(header))
  ) {
    return new Response(null, { status: 403 });
  }

  const headers = new Headers({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": allowedMethods.join(", "),
    "Access-Control-Allow-Headers": policy.allowedHeaders.join(", "),
  });
  if (policy.allowCredentials) {
    headers.set("Access-Control-Allow-Credentials", "true");
  }
  appendVary(headers, "Origin");
  appendVary(headers, "Access-Control-Request-Method");
  appendVary(headers, "Access-Control-Request-Headers");

  return new Response(null, { status: 204, headers });
}

export function applyCors(request: Request, response: Response, policy: CorsPolicy): Response {
  const url = new URL(request.url);
  const isFederation =
    url.pathname === "/api/v1/federation" || url.pathname === "/api/v1/federation/";
  const origin = request.headers.get("Origin");

  if (isFederation) {
    const headers = new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin", origin ?? "*");
    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  }

  if (origin === null || !policy.allowedOrigins.includes(origin)) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  if (policy.allowCredentials) {
    headers.set("Access-Control-Allow-Credentials", "true");
  }
  appendVary(headers, "Origin");

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}
