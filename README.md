# Sottara — private, programmable mail on Stellar

![Stellar](https://img.shields.io/badge/Stellar-Soroban-7D00FF?logo=stellar&logoColor=white)

> **Your inbox. Your rules. Proof for every delivery.**

[![CI](https://github.com/Stellar-sottara/sottara/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Stellar-sottara/sottara/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

| Review item       | Current status                                                                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| License           | MIT; see [`LICENSE`](LICENSE)                                                                                                                                                            |
| Development       | Local application and testnet development paths; beta software                                                                                                                           |
| Hosted experience | No verified public Sottara demo URL yet; the screenshot-like panel below is an illustration                                                                                              |
| CI / deployment   | Check the [latest CI run](https://github.com/Stellar-sottara/sottara/actions/workflows/ci.yml) and [deployment notes](docs/deployment/README.md); CI success and deployment are separate |
| Contributions     | Public issues and pull requests are welcome; see [`CONTRIBUTING.md`](CONTRIBUTING.md)                                                                                                    |

Sottara is an open-source beta for private email built around Stellar identity and programmable inbox access. Mailbox owners can decide how unfamiliar senders reach them: allow a verified identity, request approval, require postage, or block the sender. Encrypted message content stays off-chain; Stellar is used for identity and verifiable protocol actions.

**Project status:** beta. The application, API, relay, protocol, and Soroban contracts are in this repository. Local development and testnet paths are available. Production readiness and a public hosted demo are separate deployment milestones; check the [deployment status](docs/deployment/README.md) before relying on any endpoint.

![Sottara product and visual identity overview](docs/assets/sottara-brand-board.svg)

_Product and design overview. The message flow is conceptual and does not claim that a hosted mail service is available._

## Table of Contents

- [Why Sottara exists](#why-sottara-exists)
- [How a message flows](#how-a-message-flows)
- [Product capabilities in this beta](#product-capabilities-in-this-beta)
- [Try the project](#try-the-project)
- [Documentation map](#documentation-map)
- [Stellar and Soroban](#stellar-and-soroban)
- [Environment variables](#environment-variables)
- [Security](#security)
- [Contributing](#contributing)
- [Beta boundaries](#beta-boundaries)
- [Prerequisites](#prerequisites)

## Why Sottara exists

Email makes it easy for anyone to contact an inbox, but the recipient has few tools to set admission rules before a message arrives. Sottara explores a different model: senders present verifiable identity and meet the policy selected by the recipient. That can make abuse more costly, give recipients better control, and make delivery claims easier to inspect.

Sottara is not a replacement for Stellar wallets and does not put private message bodies on-chain. The Stellar layer supports identity, policy, postage, receipts, and lifecycle evidence. Relays and encrypted object storage carry message payloads.

## How a message flows

1. **Resolve the sender.** A Sottara address or Stellar account is resolved to an identity and the keys needed by the client.
2. **Evaluate the recipient’s rules.** The sender learns which admission requirements apply, such as trusted-sender access, verification, explicit approval, or postage.
3. **Encrypt and submit.** The client prepares an encrypted envelope and sends it through the relay or configured storage path.
4. **Record protocol evidence.** Where the configured chain adapter is enabled, postage and delivery state can be associated with Stellar contract records and receipts.
5. **Inspect the result.** The recipient can review sender provenance, delivery state, and available proof details in the client.

```mermaid
flowchart LR
  S[Sender client] --> I[Identity resolution]
  I --> P[Recipient policy]
  P -->|allowed / approval / postage| E[Encrypt envelope]
  E --> R[Relay and encrypted storage]
  E --> C[Stellar / Soroban evidence]
  R --> D[Recipient client]
  C --> D
  D --> V[Verify provenance and receipt]
```

This diagram describes the intended protocol path. Which steps are active depends on the runtime profile and configured adapters; local demos use synthetic data and are not evidence of a production mail service.

## Product capabilities in this beta

| Area                      | What the repository contains                                                                     | Where to look                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Inbox and sender requests | Mailbox views, message actions, sender review, and recipient policy flows                        | [`src/features/mail/`](src/features/mail/), [`src/features/requests/`](src/features/requests/)         |
| Identity                  | Stellar account and federation resolution, wallet linking, and sender provenance                 | [`src/features/identity/`](src/features/identity/), [`src/services/stellar/`](src/services/stellar/)   |
| Encryption                | Message-envelope, attachment, key-derivation, and recipient wrapping code with synthetic vectors | [`src/services/crypto/`](src/services/crypto/), [`protocol/messages/`](protocol/messages/)             |
| Relay and storage         | Message submission, relay authentication, encrypted object storage, and delivery state           | [`src/services/relay/`](src/services/relay/), [`src/services/storage/`](src/services/storage/)         |
| Stellar contracts         | Soroban contracts for sender policy, postage, receipts, and message lifecycle                    | [`contracts/soroban/`](contracts/soroban/)                                                             |
| Proof inspection          | UI and API types for inspecting sender and delivery evidence                                     | [`src/features/proof-inspector/`](src/features/proof-inspector/), [`src/server/api/`](src/server/api/) |

These are implementation areas, not a promise that every feature is available in a shared hosted environment. Some paths require testnet configuration, operator-managed services, or secrets and are intentionally not enabled in public demos.

## Try the project

### Local application

**Requirements:** Node.js 24 or newer and Bun 1.3.14. Rust is needed to build or test the Soroban contracts; use the version pinned in [`rust-toolchain.toml`](rust-toolchain.toml).

```sh
git clone https://github.com/Stellar-sottara/sottara.git
cd sottara
bun install --frozen-lockfile
cp .env.example .env
bun run dev
```

The Vite development server prints the local URL when it starts. The default development profile is intended for local work and uses development adapters. Use test accounts and synthetic messages. Do not paste wallet seeds, real user content, production tokens, or private keys into `.env`, fixtures, screenshots, logs, issues, or pull requests.

### Useful commands

```sh
bun run format:check       # formatting
bun run lint               # lint
bun x tsc --noEmit         # TypeScript types
bun run test               # unit tests
bun run build              # production bundle / worker build
bun run test:security      # security and authorization regressions
bun run test:e2e           # Chromium end-to-end browser flows
bun run test:visual        # cross-browser visual regressions
bun run test:load          # relay/API load and performance budget
bun run ci:verify-drift    # generated/configuration drift checks
```

Contract-focused work should also run the relevant commands in [`contracts/soroban/`](contracts/soroban/). See [contributor setup](CONTRIBUTING.md) for the repository workflow and [security verification](docs/security/README.md) for security-specific checks.

## Documentation map

- [Product overview and walkthrough](docs/product/README.md) — audience, product model, user flows, beta boundaries, and review path.
- [System architecture](docs/architecture/README.md) — trust boundaries, components, request flow, and module map.
- [API guide](docs/api/README.md) — endpoint groups, authentication, errors, and local examples.
- [Protocol guide](docs/protocol/README.md) — message envelopes, identity, postage, and interoperability notes.
- [Security documentation](docs/security/README.md) — threat model, controls, remaining risks, and verification checklist.
- [Deployment status and runbooks](docs/deployment/README.md) — environments, configuration, release gates, and deployment evidence.
- [Contributor guide](CONTRIBUTING.md) — supported tools, checks, ownership boundaries, and pull-request expectations.
- [Stellar Wave maintainer brief](docs/product/stellar-wave-readiness.md) — project fit, contributor opportunities, and application preparation.
- [Brand and compatibility migration](docs/product/brand-migration.md) — remaining legacy domains and identifiers that require coordinated cutover.

## Stellar and Soroban

Sottara uses Stellar as a programmable identity and protocol-evidence layer. Soroban contracts in this repository define policy, postage, receipts, and lifecycle behavior. The client and services include adapters that connect those contracts to message admission and delivery flows. Contract code, deployment manifests, and environment configuration have distinct roles; a local contract build is not proof that a contract is deployed or that a live application is using it.

The system is designed to keep message bodies and attachments out of public ledger state. Ledger transactions and contract events can still reveal operational metadata such as account relationships, payment amounts, timing, and public contract activity. Review the [metadata policy](docs/security/metadata-policy.md) before handling sensitive data.

## Environment variables

Runtime configuration is loaded and validated by `src/config/loader.ts` (`loadRuntimeConfig`). Variables can be configured in `.env` (copy from [`.env.example`](.env.example) for local development) or bound via environment secrets in deployment.

For the production secret inventory, rotation cadence, and emergency revocation procedures, see the [Secrets Inventory & Operational Procedures](docs/deployment/SECRETS.md).

| Variable group         | Key variables                                                                                                                                                                                                                                                                                                                       | Description                                                                                                                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Network**            | `STEALTH_STELLAR_NETWORK`, `STEALTH_HORIZON_URL`, `STEALTH_SOROBAN_RPC_URL`, `STEALTH_NETWORK_PASSPHRASE`                                                                                                                                                                                                                           | Network selection (`testnet` / `mainnet`), Horizon and Soroban RPC endpoints, and network passphrases.                                                                                                        |
| **Storage**            | `STEALTH_STORAGE_DRIVER`, `STEALTH_KV_NAMESPACE_ID`, `STEALTH_KV_LOCAL_ID`, `STEALTH_KV_PREVIEW_ID`, `STEALTH_KV_PRODUCTION_ID`                                                                                                                                                                                                     | Storage backend driver (`memory`, `hybrid`), KV namespace IDs, and Cloudflare bindings (see [`.env.example`](.env.example) and [`scripts/generate-wrangler-config.ts`](scripts/generate-wrangler-config.ts)). |
| **Session & Security** | `STEALTH_AUTH_CHALLENGE_LIFETIME_MS`, `STEALTH_AUTH_CLOCK_SKEW_MS`, `STEALTH_AUTH_NONCE_TTL_MS`, `STEALTH_QUOTE_LIFETIME_MS`                                                                                                                                                                                                        | Lifetime and replay-protection tolerances for cryptographic authentication challenges, session nonces, and fee quotes.                                                                                        |
| **Relay**              | `STEALTH_RELAY_URL`, `STEALTH_RELAY_TIMEOUT_MS`, `STEALTH_RELAY_API_KEY`                                                                                                                                                                                                                                                            | Relay federation and message delivery endpoints, connection timeouts, and authentication keys.                                                                                                                |
| **Contract**           | `STEALTH_REGISTRY_CONTRACT_ID`, `STEALTH_POSTAGE_CONTRACT_ID`, `STEALTH_LIFECYCLE_CONTRACT_ID`, `STEALTH_RECEIPTS_CONTRACT_ID`, `STEALTH_POLICIES_CONTRACT_ID`, `STEALTH_DOMAIN_TAG`, `STEALTH_PROTOCOL_VERSION`                                                                                                                    | Soroban smart contract IDs for policies, postage, receipts, and lifecycle tracking, alongside protocol domain separation tags.                                                                                |
| **Origin & CORS**      | `STEALTH_APP_URL`, `STEALTH_CORS_ALLOWED_ORIGINS`, `STEALTH_CORS_ALLOWED_METHODS`, `STEALTH_CORS_ALLOWED_HEADERS`, `STEALTH_CORS_ALLOW_CREDENTIALS`                                                                                                                                                                                 | Public web application URL and cross-origin resource sharing policy configurations.                                                                                                                           |
| **Notifications**      | `STEALTH_NOTIFICATION_TRANSPORT`, `STEALTH_SMTP_HOST`, `STEALTH_SMTP_PORT`, `STEALTH_SMTP_SECURE`, `STEALTH_SMTP_STARTTLS`, `STEALTH_SMTP_USERNAME`, `STEALTH_SMTP_PASSWORD`, `STEALTH_NOTIFICATION_FROM`, `STEALTH_VERIFICATION_TOKEN_LIFETIME_MS`, `STEALTH_VERIFICATION_RESEND_COOLDOWN_MS`, `STEALTH_VERIFICATION_MAX_ATTEMPTS` | Outbound notification transport (`smtp` or local `sink`), mail server connection parameters, and verification token TTLs.                                                                                     |
| **Beta controls**      | `STEALTH_BETA_CONTROL_TTL_SECONDS`, `STEALTH_BETA_KILLSWITCH_DEFAULT`, `STEALTH_BETA_KILLSWITCH_<CAPABILITY>`, `STEALTH_BETA_FLAG_<NAME>`                                                                                                                                                                                           | Dynamic capability kill switches, control cache TTLs, and beta feature toggle flags.                                                                                                                          |
| **Secrets & Cursors**  | `STEALTH_CURSOR_SECRET`, `STEALTH_STORAGE_SECRET`, `STEALTH_RPC_API_KEY`, `STEALTH_OPERATOR_SECRET`, `STEALTH_BACKUP_KEY`                                                                                                                                                                                                           | Sensitive cryptographic keys and operator custody secrets. Documented in [Secrets Inventory](docs/deployment/SECRETS.md); never committed to source control.                                                  |

## Security

- **Never commit secrets** — keep keys, seed phrases, and `.env` files out of source control.
- **Testnet values have no real-world value**; treat testnet deployments as experimental.
- **Keys never leave the wallet** — signing is delegated to the user's Stellar wallet; the app does not store secret keys.
- Report vulnerabilities per `SECURITY.md` where present rather than opening a public issue.

## Contributing

Good contribution areas include protocol interoperability vectors, contract failure-path coverage, relay reliability, accessible inbox and sender-request flows, and clear operator documentation. Wave issues should be bounded, independently testable, and possible to complete without production credentials or private user data.

Start with [`CONTRIBUTING.md`](CONTRIBUTING.md), then read the relevant module guide. The project uses a review-first workflow: discuss large changes in an issue, keep changes focused, include exact validation results, and never add secrets or real message content to the repository.

Sottara has an MIT license; see [`LICENSE`](LICENSE). Participation in the Stellar Wave is subject to organizer approval and the program’s current rules. The [maintainer guide](https://docs.drips.network/wave/maintainers/participating-in-a-wave/) explains how to apply a public repository, add issues after approval, and manage contributor assignments.

## Beta boundaries

- Sottara is experimental software. Do not use it as the sole channel for sensitive, urgent, or legally required communication.
- A testnet deployment does not provide production availability, email deliverability, or financial guarantees.
- Existing federation domains, API headers, signature domains, deployment resources, and storage keys still use legacy identifiers. They remain for compatibility until their migrations are coordinated; see the [migration guide](docs/product/brand-migration.md).
- A public landing page or hosted preview is not equivalent to a production mail service. Check the [deployment status](docs/deployment/README.md) for the current verified endpoint and its limitations.

## License

Sottara is distributed under the [MIT License](LICENSE).

## Prerequisites

| Tool                    | Notes             |
| ----------------------- | ----------------- |
| **Node.js**             | 24+ and Bun 1.3   |
| **Cloudflare Wrangler** | Workers / KV      |
| **Rust**                | for the contracts |
