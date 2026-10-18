#!/usr/bin/env node
/**
 * BETA-089 — fails when the deployment log records two successful deployments
 * for the same commit (duplicate side effects). The Post-Deployment Verification
 * job downloads the `production-deployment-log` artifact before this script
 * runs, so the log is present at the point the check executes.
 *
 * Usage: node scripts/ci/verify-no-duplicate-side-effects.mjs [log-file]
 */
import { readFileSync } from "node:fs";

const LOG_FILE = process.argv[2] ?? "docs/deployment/deployment-log.txt";

let log;
try {
  log = readFileSync(LOG_FILE, "utf-8");
} catch {
  console.error(`Deployment log not found at ${LOG_FILE}`);
  process.exit(1);
}

const successes = log
  .split("\n")
  .filter((line) => line.includes("production") && line.includes("SUCCESS"));

console.log(`Successful deployments recorded: ${successes.length}`);

const seen = new Set();
const duplicates = new Set();
for (const line of successes) {
  const commit = line.split("|")[2]?.trim() ?? "";
  if (!commit) continue;
  if (seen.has(commit)) duplicates.add(commit);
  seen.add(commit);
}

if (duplicates.size > 0) {
  console.error("Duplicate successful deployments detected for the same commit:");
  for (const commit of [...duplicates].sort()) console.error(`  ${commit}`);
  process.exit(1);
}

console.log("✓ No duplicate deployments detected");
