import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("pr-preview-deploy.yml workflow condition validation (Issue #36)", () => {
  const workflowPath = resolve(process.cwd(), ".github/workflows/pr-preview-deploy.yml");
  const content = readFileSync(workflowPath, "utf-8");

  it("does not reference step-local env.CLOUDFLARE_API_TOKEN in the deploy if condition", () => {
    // env.CLOUDFLARE_API_TOKEN in step if: was always empty because secrets and step-local env are not evaluated there
    expect(content).not.toMatch(/if:.*env\.CLOUDFLARE_API_TOKEN/);
  });

  it("includes a check-preview-creds step that exports has_token output", () => {
    expect(content).toContain("id: check-preview-creds");
    expect(content).toContain('echo "has_token=true" >> "$GITHUB_OUTPUT"');
    expect(content).toContain('echo "has_token=false" >> "$GITHUB_OUTPUT"');
  });

  it("gates preview deploy on non-fork and valid credential step output", () => {
    expect(content).toMatch(/steps\.check-preview-creds\.outputs\.has_token\s*==\s*'true'/);
    expect(content).toMatch(/env\.IS_FORK\s*!=\s*'true'/);
  });

  it("preserves pinned wrangler deployment command", () => {
    expect(content).toContain("npx wrangler@4.105.0 deploy");
  });
});
