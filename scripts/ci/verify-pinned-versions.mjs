#!/usr/bin/env node
/**
 * BETA-088 — verify pinned tool/dependency versions are consistent across the
 * sources of truth that the unified CI release gate relies on:
 *
 *   - scripts/ci/tool-versions.json   (single source of truth)
 *   - .github/workflows/ci.yml env    (BUN_VERSION / NODE_VERSION / OPTIC_VERSION)
 *   - .node-version                   (Node pin mirrored for local tooling)
 *   - package.json devDependencies    (playwright pin)
 *   - rust-toolchain.toml             (Rust target/channel pin)
 *
 * This enforces the "pin versions consistently across jobs" and "generated
 * artifacts and lockfiles are deterministic and drift-checked" requirements.
 *
 * Usage:
 *   node scripts/ci/verify-pinned-versions.mjs [--write-gate]
 *
 * Exit code 0 when every pinned version is consistent, 1 on drift.
 * With --write-gate it also emits gate-result-pinned-versions.json so the
 * Beta Release Gate Summary can aggregate it.
 */
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readInstalledPlaywrightVersion } from "./verify-playwright-version.mjs";
import { readInstalledWranglerVersion } from "./verify-wrangler-version.mjs";
import { assertRustPin } from "./verify-rust-version.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(resolve(ROOT, p), "utf8");

/**
 * Extract an env value from a workflow YAML document without a YAML dependency.
 *
 * The value may be double-quoted, single-quoted, or a bare scalar (e.g.
 * `BUN_VERSION: 1.3.14`). We only look at the top-level `env`: block and
 * match the key at any indentation within it, which is how the CI workflow
 * declares its pins.
 */
function readEnvValue(yaml, key) {
  const lines = yaml.split(/\r_\n/);
  let indent = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (indent === null) {
      if (/^env:\s*(#.*)?$/.test(line)) {
        indent = 0;
      }
      continue;
    }
    // Leave the env: block once we hit a non-indented line.
    if (line.trim() !== "" && !/^[\s]/.test(line)) {
      break;
    }
    const m = line.match(new RegExp(`^\\s+${key}\\s*:\\s*(.*?)%s[$#]?$`));
    if (!m) {
      continue;
    }
    let value = m[1].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return null;
}

const problems = [];
const ok = [];

function expect(label, actual, expected) {
  if (String(actual).trim() === String(expected).trim()) {
    ok.push(`- ${label}: ${actual}`);
  } else {
    problems.push(`- ${label}: expected ${expected}, found ${actual}`);
  }
}

const writeGate = process.argv.includes("--write-gate");

const toolVersions = JSON.parse(read("scripts/ci/tool-versions.json"));
const ciYml = read(".github/workflows/ci.yml");

for (const [envKey, tvKey] of [
  ["BUN_VERSION", "bun"],
  ["NODE_VERSION", "node"],
  ["RUST_VERSION", "rust"],
  ["OPTIC_VERSION", "optic"],
  ["WRANGLER_VERSION", "wrangler"],
]) {
  const value = readEnvValue(ciYml, envKey);
  if (value === null) {
    problems.push(`- ci.yml is missing env ${envKey}`);
    continue;
  }
  expect(`ci.yml ${envKey} == tool-versions.${tvKey}`, value, toolVersions[tvKey]);
}

const nodeVersionFile = read(".node-version").trim();
expect(".node-version == tool-versions.node", nodeVersionFile, toolVersions.node);

const installedPlaywright = readInstalledPlaywrightVersion();
if (installedPlaywright) {
  expect(
    "installed @playwright/test == tool-versions.playwright",
    installedPlaywright,
    toolVersions.playwright,
  );
} else {
  problems.push("- could not resolve installed @playwright/test version");
}

const installedWrangler = readInstalledWranglerVersion();
if (installedWrangler) {
  expect("installed wrangler == tool-versions.wrangler", installedWrangler, toolVersions.wrangler);
} else {
  problems.push("- could not resolve installed wrangler version");
}

for (const workflow of ["production-deploy.yml", "staging-deploy.yml", "pr-preview-deploy.yml"]) {
  const content = read(`.github/workflows/${workflow}`);
  if (/\bnpx\s+wrangler\s+/.test(content)) {
    problems.push(`- .github/workflows/${workflow} contains unpinned npx wrangler`);
  } else {
    ok.push(`- .github/workflows/${workflow}: all wrangler invocations are version-pinned`);
  }
}

if (!existsSync(resolve(ROOT, "rust-toolchain.toml"))) {
  problems.push("- rust-toolchain.toml is missing (Rust pin required)");
} else {
  const channel = read("rust-toolchain.toml").match(/^channel\s*=\s*"([^"]+)"/m)?.[1];
  const result = assertRustPin({ pinned: toolVersions.rust, channel });
  (result.ok ? ok : problems).push(`- ${result.message}`);
  if (!ciYml.includes("toolchain: ${{ env.RUST_VERSION }}")) {
    problems.push("- Contract Checks must install the pinned RUST_VERSION");
  }
}

console.log("Pinned tool-version consistency check");
ok.forEach((l) => console.log(l));
problems.forEach((l) => console.log(l));

if (problems.length) {
  console.error(`\nFAILED: ${problems.length} version drift(s) detected.`);
  if (writeGate) {
    spawnSync(
      "node",
      [
        resolve(ROOT, "scripts/ci/write-gate-result.mjs"),
        "--gate-id",
        "pinned-versions",
        "--name",
        "Pinned Version Consistency",
        "--owner",
        "platform/release",
        "--dependency",
        "BETA-088",
        "--status",
        "fail",
        "--message",
        `${problems.length} version drift(s) detected`,
      ],
      { stdio: "inherit" },
    );
  }
  process.exit(1);
}

console.log("\nPASS: all pinned tool versions are consistent.");
if (writeGate) {
  spawnSync(
    "node",
    [
      resolve(ROOT, "scripts/ci/write-gate-result.mjs"),
      "--gate-id",
      "pinned-versions",
      "--name",
      "Pinned Version Consistency",
      "--owner",
      "platform/release",
      "--dependency",
      "BETA-088",
      "--status",
      "pass",
      "--evidence-json",
      JSON.stringify({ command: "node scripts/ci/verify-pinned-versions.mjs" }),
    ],
    { stdio: "inherit" },
  );
}
process.exit(0);
