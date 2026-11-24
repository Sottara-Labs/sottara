import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REQUIRED_GATES } from "../../../scripts/ci/release-gate-lib.mjs";

describe("staging-deploy.yml release gate enforcement (Issues #276, #277)", () => {
  const workflowPath = resolve(process.cwd(), ".github/workflows/staging-deploy.yml");
  const content = readFileSync(workflowPath, "utf-8");

  it("fails closed when the release gate summary is unavailable", () => {
    expect(content).toContain('SUMMARY_FILE="gate-artifacts/release-gate-summary.json"');
    expect(content).toMatch(/if \[ ! -f "\$SUMMARY_FILE" \]; then/);
    expect(content).toContain("release gate summary is unavailable");
    expect(content).toMatch(/echo "releasable=false" >> "\$GITHUB_OUTPUT"\n\s+exit 1/);
  });

  it("does not deploy when the summary is not releasable", () => {
    expect(content).toMatch(/if \[ "\$RELEASABLE" != "true" \]; then/);
    expect(content).toContain("not releasable");
  });

  it("derives the critical gate set from REQUIRED_GATES instead of a hand-maintained list", () => {
    expect(content).toContain("m.REQUIRED_GATES.join");
    expect(content).not.toMatch(/CRITICAL_GATES=\("client-checks"/);
  });

  it("includes every security gate through the shared required-gate list", () => {
    expect(REQUIRED_GATES).toEqual(expect.arrayContaining(["security", "beta-security"]));
  });
});
