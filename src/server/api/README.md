# Server API

The server API is the shared boundary for TanStack Start routes under
`src/routes/api/v1/`. It keeps request parsing, authentication, authorization,
domain operations, and response envelopes consistent across endpoints.

## Request pipeline

Most routes are built with `createRouteHandler` from `handler.ts`. The handler:

1. Resolves a request-scoped `ApiContext` from `context.ts`.
2. Applies the route's authentication mode and authorization policy.
3. Enforces configured CORS, rate limits, and abuse controls.
4. Parses validated query, path, and JSON body input.
5. Maps `ApiError` and unexpected failures into the versioned error envelope.

Use `request.ts` for body and parameter parsing, `actor.ts` and
`authorization/` for identity checks, and `response.ts` for success/error
envelopes. Do not read credentials or derive an actor directly in a route.

## Context and persistence

`context.ts` assembles the repository and optional relay, mailbox, Stellar, and
notification dependencies for a request. `repository.ts` defines the storage
boundary; `memory-repository.ts` is the local/test implementation and
`kv-repository.ts` is the Cloudflare KV implementation. Domain services accept
these dependencies so route handlers remain thin and testable.

## Finding code

- Authentication and sessions: `auth/`, `actor.ts`, `admin-auth.ts`
- Mailbox and relay flows: `mailbox-live.ts`, `policy-service.ts`,
  `postage-service.ts`, `send-coordinator.ts`
- Accounts and settings: `account-data-service.ts`, `account-settings-service.ts`,
  `contact-service.ts`
- Operational controls: `beta-controls/`, `rate-limit.ts`, `abuse-service.ts`,
  `audit.ts`
- Contract and protocol boundaries: `openapi.ts`, `protocol.ts`,
  `src/services/stellar/`

Start from the matching route under `src/routes/api/v1/`, then follow its
service and repository calls. Unit tests under `tests/unit/api/` and the
domain-specific folders verify the boundary behavior.
