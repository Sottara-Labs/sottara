/**
 * BETA-088 — shared release-gate summary semantics.
 * Required gate IDs must stay in sync with the release-gate workflow artifacts
 * (`.github/workflows/ci.yml` and `.github/workflows/beta-live-testnet.yml`).
 */

export const REQUIRED_GATES = Object.freeze([
  "client-checks",
  "contract-checks",
  "contract-registry",
  "beta-migrations",
  "beta-backup",
  "beta-auth",
  "beta-security",
  "beta-live-data",
  "beta-performance",
  "beta-acceptance",
  "e2e",
  "visual-e2e",
  "security",
  "provenance",
  "build-reproducibility",
  "pinned-versions",
  "artifact-secrets",
  "beta-soroban-live",
  "beta-live-workflow2",
]);

export const GATE_OWNERS = Object.freeze({
  governance: "platform/release",
  "client-checks": "platform/client",
  "contract-checks": "platform/contracts",
  "build-reproducibility": "platform/client",
  "pinned-versions": "platform/release",
  "contract-registry": "platform/contracts",
  "beta-migrations": "platform/storage",
  "beta-backup": "platform/storage",
  "beta-auth": "security/platform",
  "beta-security": "security/platform",
  "beta-live-data": "protocol/relay",
  "beta-performance": "platform/performance",
  "beta-acceptance": "product/ux",
  e2e: "platform/client",
  "visual-e2e": "platform/client",
  security: "security/platform",
  "artifact-secrets": "security/platform",
  provenance: "platform/release",
  "beta-soroban-live": "platform/contracts",
  "beta-live-workflow2": "protocol/relay",
});

/** Privileged scans may skip on fork PRs; they must not count as a silent pass for releasable. */
export const FORK_ALLOWED_SKIPS = Object.freeze(["security"]);

/**
 * Gates written by the operator-triggered `.github/workflows/beta-live-testnet.yml`
 * run. They are part of the required set, but their results cannot appear in an
 * ordinary `ci.yml` summary: artifacts from another workflow run are only visible
 * with explicit `run-id` scoping, which the summary job does not use. Their absence
 * is therefore reported as `skipped` (never a silent pass — `releasable` stays
 * false), while a recorded failure blocks the summary like any other gate.
 */
export const OPERATOR_GATES = Object.freeze(["beta-soroban-live", "beta-live-workflow2"]);

export const MISSING_GATE_REASON = "missing required gate result";
export const MISSING_OPERATOR_GATE_REASON = "operator-triggered gate result not in this run";

const STATUS_RANK = { fail: 0, blocked: 1, skipped: 2, pass: 3 };

export function assembleGates(loadedGates, { requiredGates = REQUIRED_GATES } = {}) {
  const byId = new Map();
  for (const gate of loadedGates) {
    if (!gate?.gateId) continue;
    const copy = { ...gate };
    if (!copy.owner && GATE_OWNERS[copy.gateId]) copy.owner = GATE_OWNERS[copy.gateId];
    byId.set(copy.gateId, copy);
  }

  const missingRequiredGates = requiredGates.filter((id) => !byId.has(id));
  for (const id of missingRequiredGates) {
    const operator = OPERATOR_GATES.includes(id);
    byId.set(id, {
      gateId: id,
      name: id,
      owner: GATE_OWNERS[id] ?? "unassigned",
      dependency: "BETA-088",
      status: operator ? "skipped" : "fail",
      message: operator ? MISSING_OPERATOR_GATE_REASON : MISSING_GATE_REASON,
    });
  }

  const gates = sortGates([...byId.values()], requiredGates);
  return { gates, missingRequiredGates };
}

export function sortGates(gates, requiredGates = REQUIRED_GATES) {
  const index = new Map(requiredGates.map((id, i) => [id, i]));
  return [...gates].sort((a, b) => {
    const ai = index.has(a.gateId) ? index.get(a.gateId) : requiredGates.length;
    const bi = index.has(b.gateId) ? index.get(b.gateId) : requiredGates.length;
    if (ai !== bi) return ai - bi;
    const rank = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
    if (rank !== 0) return rank;
    return String(a.gateId).localeCompare(String(b.gateId));
  });
}

export function overallVerdict(items, { requiredGates = REQUIRED_GATES, forkPr = false } = {}) {
  if (!items || items.length === 0) return "fail";
  const present = new Set(items.map((g) => g.gateId));
  if (requiredGates.some((id) => !present.has(id))) return "fail";
  if (items.some((g) => g.status === "fail")) return "fail";
  if (items.some((g) => g.status === "blocked")) return "blocked";

  const allowedSkip = new Set([...(forkPr ? FORK_ALLOWED_SKIPS : []), ...OPERATOR_GATES]);
  const requiredItems = requiredGates.map((id) => items.find((g) => g.gateId === id));
  for (const gate of requiredItems) {
    if (gate.status === "pass") continue;
    if (gate.status === "skipped" && allowedSkip.has(gate.gateId)) continue;
    return "fail";
  }
  return "pass";
}

export function isReleasable(items, { requiredGates = REQUIRED_GATES } = {}) {
  return requiredGates.every((id) => {
    const gate = items.find((g) => g.gateId === id);
    return gate?.status === "pass";
  });
}

export function buildReleaseSummary({
  loadedGates,
  commit,
  toolVersions,
  artifactHashes,
  generatedAt,
  forkPr = false,
  requiredGates = REQUIRED_GATES,
}) {
  const { gates, missingRequiredGates } = assembleGates(loadedGates, { requiredGates });
  const verdict = overallVerdict(gates, { requiredGates, forkPr });
  const failed = gates.filter((g) => g.status === "fail");
  const blocked = gates.filter((g) => g.status === "blocked");

  return {
    issue: "BETA-088",
    verdict,
    releasable: isReleasable(gates, { requiredGates }),
    commit,
    generatedAt,
    toolVersions,
    requiredGates: [...requiredGates],
    missingRequiredGates,
    gates,
    artifactHashes,
    failureOwnership: [...failed, ...blocked].map((g) => ({
      gateId: g.gateId,
      name: g.name,
      owner: g.owner,
      status: g.status,
      dependency: g.dependency,
      message: g.message ?? g.failures?.[0]?.message ?? null,
    })),
  };
}

export function renderMarkdown(s) {
  const icon = { pass: "✅", fail: "❌", blocked: "⛔", skipped: "⏭️" };
  const lines = [
    `# Beta Release Gate Summary (BETA-088)`,
    ``,
    `| Field | Value |`,
    `| --- | --- |`,
    `| **Verdict** | **${s.verdict.toUpperCase()}** |`,
    `| Releasable | ${s.releasable ? "yes" : "no"} |`,
    `| Commit | \`${String(s.commit).slice(0, 12)}\` |`,
    `| Generated | ${s.generatedAt} |`,
    ``,
    `## Tool Versions`,
    ``,
    `| Tool | Version |`,
    `| --- | --- |`,
    `| Bun | ${s.toolVersions?.bun ?? "—"} |`,
    `| Node | ${s.toolVersions?.node ?? "—"} |`,
    `| Rust | ${s.toolVersions?.rust ?? "—"} |`,
    `| Playwright | ${s.toolVersions?.playwright ?? "—"} |`,
    `| Optic | ${s.toolVersions?.optic ?? "—"} |`,
    `| Soroban SDK | ${s.toolVersions?.sorobanSdk ?? "—"} |`,
    ``,
    `## Gate Matrix`,
    ``,
    `| Gate | Owner | Status | Dependency |`,
    `| --- | --- | --- | --- |`,
  ];

  for (const g of s.gates) {
    lines.push(
      `| ${g.name} (\`${g.gateId}\`) | ${g.owner ?? "—"} | ${icon[g.status] ?? ""} ${g.status} | ${g.dependency ?? "—"} |`,
    );
  }

  if (s.failureOwnership.length > 0) {
    lines.push(``, `## Failure Ownership`, ``);
    for (const f of s.failureOwnership) {
      lines.push(
        `- **${f.name}** (\`${f.gateId}\`) — owner: \`${f.owner}\`, status: **${f.status}**${f.message ? ` — ${f.message}` : ""}`,
      );
    }
  }

  if (s.missingRequiredGates.length > 0) {
    lines.push(``, `## Missing Required Gates`, ``);
    for (const gateId of s.missingRequiredGates) {
      const gate = s.gates.find((g) => g.gateId === gateId);
      lines.push(`- \`${gateId}\` (${gate?.message ?? MISSING_GATE_REASON})`);
    }
  }

  if (s.artifactHashes?.artifacts?.length) {
    lines.push(``, `## Artifact Hashes (SHA-256)`, ``);
    lines.push(`| Artifact | Hash |`, `| --- | --- |`);
    for (const a of s.artifactHashes.artifacts.slice(0, 40)) {
      lines.push(`| \`${a.path}\` | \`${a.hash}\` |`);
    }
    if (s.artifactHashes.artifacts.length > 40) {
      lines.push(`| … | ${s.artifactHashes.artifacts.length - 40} more in artifact-hashes.json |`);
    }
  }

  lines.push(
    ``,
    `> Semantics: \`pass\` = every required gate exists and passed; operator-triggered live gates absent from the run are \`skipped\`, never a pass. \`blocked\` = unresolved named dependency. \`fail\` = a required gate failed or is missing. Fork PRs may \`skip\` privileged \`security\` scans; that is never releasable.`,
  );
  return lines.join("\n") + "\n";
}
