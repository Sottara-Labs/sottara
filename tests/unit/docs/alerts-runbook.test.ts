import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const ALERTS = readFileSync(join(ROOT, "docs/deployment/ALERTS.md"), "utf-8");
const LOADER = readFileSync(join(ROOT, "src/config/loader.ts"), "utf-8");

describe("ALERTS.md runbook variables", () => {
  it("only names STEALTH_ variables the config loader reads", () => {
    const names = [...new Set(ALERTS.match(/STEALTH_[A-Z0-9_]+/g) ?? [])];
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(LOADER, name).toContain(name);
    }
  });

  it("does not document RPC fallback variables that do not exist", () => {
    expect(ALERTS).not.toMatch(/SOROBAN_RPC_FALLBACK_URL|HORIZON_FALLBACK_URL/);
  });
});
