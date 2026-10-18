import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOW = join(process.cwd(), ".github/workflows/production-deploy.yml");
const SCRIPT = join(process.cwd(), "scripts/ci/verify-no-duplicate-side-effects.mjs");

function runCheck(log: string | null): { status: number; output: string } {
  const dir = mkdtempSync(join(tmpdir(), "duplicate-side-effects-"));
  try {
    const logPath = join(dir, "deployment-log.txt");
    if (log !== null) writeFileSync(logPath, log);
    const output = execFileSync(process.execPath, [SCRIPT, logPath], {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? -1,
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SUCCESS_ABC = "2026-08-21T10:00:00Z | production | abc123 | operator | SUCCESS";
const SUCCESS_DEF = "2026-08-21T12:00:00Z | production | def456 | operator | SUCCESS";

describe("production deploy duplicate side-effect check", () => {
  it("fails when the log records two deployments for the same commit", () => {
    const result = runCheck([SUCCESS_ABC, SUCCESS_DEF.replace("def456", "abc123")].join("\n"));
    expect(result.status).toBe(1);
    expect(result.output).toContain("abc123");
  });

  it("passes when every recorded deployment has a distinct commit", () => {
    const result = runCheck([SUCCESS_ABC, SUCCESS_DEF].join("\n"));
    expect(result.status).toBe(0);
  });

  it("ignores rollback entries and fails when the log is missing", () => {
    const rollback = "2026-08-21T11:00:00Z | production | abc123 | operator | ROLLED BACK";
    const result = runCheck([SUCCESS_ABC, rollback].join("\n"));
    expect(result.status).toBe(0);
    expect(runCheck(null).status).toBe(1);
  });

  it("downloads the deployment log before running the check", () => {
    const workflow = readFileSync(WORKFLOW, "utf-8");
    const jobStart = workflow.indexOf("  post-deployment-verification:");
    expect(jobStart).toBeGreaterThanOrEqual(0);
    const job = workflow.slice(jobStart);
    const checkAt = job.indexOf("verify-no-duplicate-side-effects.mjs");
    expect(checkAt).toBeGreaterThanOrEqual(0);
    const beforeCheck = job.slice(0, checkAt);
    expect(beforeCheck).toMatch(/uses: actions\/download-artifact/);
    expect(beforeCheck).toContain("production-deployment-log");
    // The old inline script could not fail, so it must be gone.
    expect(job).not.toContain("This is expected for rollback scenarios");
  });
});
