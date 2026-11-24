#!/usr/bin/env node
/**
 * Verifies that REQUIRED_GATES is the single source of truth for the release
 * gate matrix:
 *
 *  - every gate artifact any release workflow produces is listed in REQUIRED_GATES;
 *  - every listed gate is actually produced by a release workflow;
 *  - the release-gate-summary `needs:` list depends on every CI job that produces
 *    a required gate, so the two lists cannot silently drift apart again.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { REQUIRED_GATES } from "./release-gate-lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOW_DIR = join(ROOT, ".github/workflows");

// Deploy workflow gates are emitted after a deployment, not part of the release matrix.
const GATE_WORKFLOWS = ["ci.yml", "beta-live-testnet.yml"];

// PR-scoped gates are reported in the summary but are not required for a release.
const PR_SCOPED_GATES = new Set(["governance"]);

// Evidence files look like gate-result-beta-098-acceptance.json; they are not gate results.
const EVIDENCE_ID = /^beta-\d{3}-/;

function gateIdsIn(text) {
  const ids = new Set();
  for (const match of text.matchAll(/--gate-id\s+([a-z0-9][a-z0-9-]*)/g)) ids.add(match[1]);
  for (const match of text.matchAll(/gate-result-([a-z0-9][a-z0-9-]*)\.json/g)) {
    if (!EVIDENCE_ID.test(match[1])) ids.add(match[1]);
  }
  return ids;
}

const required = new Set(REQUIRED_GATES);
const produced = new Set();
const errors = [];

for (const file of GATE_WORKFLOWS) {
  const text = readFileSync(join(WORKFLOW_DIR, file), "utf8");
  for (const id of gateIdsIn(text)) {
    produced.add(id);
    if (PR_SCOPED_GATES.has(id)) continue;
    if (!required.has(id)) {
      errors.push(`${file}: gate "${id}" is produced but missing from REQUIRED_GATES`);
    }
  }
}

for (const id of REQUIRED_GATES) {
  if (!produced.has(id)) {
    errors.push(`REQUIRED_GATES lists "${id}" but no release workflow produces gate-result-${id}.json`);
  }
}

const ci = readFileSync(join(WORKFLOW_DIR, "ci.yml"), "utf8");
const lines = ci.split(/\r?\n/);

const jobGateIds = new Map();
let currentJob = null;
for (const line of lines) {
  const jobMatch = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
  if (jobMatch) {
    currentJob = jobMatch[1];
    jobGateIds.set(currentJob, new Set());
    continue;
  }
  if (!currentJob) continue;
  for (const id of gateIdsIn(line)) jobGateIds.get(currentJob).add(id);
}

const summaryIndex = lines.findIndex((line) => /^ {2}release-gate-summary:\s*$/.test(line));
if (summaryIndex === -1) {
  errors.push("ci.yml: release-gate-summary job not found");
} else {
  const needs = new Set();
  for (let i = summaryIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^ {2}\S/.test(line)) break;
    const needMatch = /^ {4}- ([A-Za-z0-9_-]+)\s*$/.exec(line);
    if (needMatch) needs.add(needMatch[1]);
  }

  const isRelevantGate = (id) => required.has(id) || PR_SCOPED_GATES.has(id);
  const gateProducers = new Set();
  for (const [job, ids] of jobGateIds) {
    if (job === "release-gate-summary") continue;
    if ([...ids].some(isRelevantGate)) gateProducers.add(job);
  }

  for (const job of gateProducers) {
    if (!needs.has(job)) {
      errors.push(`ci.yml: release-gate-summary needs must include "${job}"`);
    }
  }
  for (const job of needs) {
    if (!jobGateIds.has(job)) {
      errors.push(`ci.yml: release-gate-summary needs unknown job "${job}"`);
    } else if (![...jobGateIds.get(job)].some(isRelevantGate)) {
      errors.push(`ci.yml: release-gate-summary needs "${job}" but it produces no required gate`);
    }
  }
}

if (errors.length > 0) {
  console.error("Gate coverage check failed:");
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}

console.log(
  `Gate coverage OK: ${REQUIRED_GATES.length} required gates, ${produced.size} produced by release workflows.`,
);
