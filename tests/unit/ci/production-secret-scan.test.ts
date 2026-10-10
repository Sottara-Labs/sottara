import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/production-deploy.yml"),
  "utf8",
);
const validation = workflow.slice(
  workflow.indexOf("# Scan for plaintext secrets in changed files"),
  workflow.indexOf(
    "production-deploy:",
    workflow.indexOf("# Scan for plaintext secrets in changed files"),
  ),
);

describe("production release plaintext-secret scan", () => {
  it("keeps the scan result in the parent shell", () => {
    expect(validation).toContain(
      'done < <(git diff-tree --no-commit-id --name-only -r "$COMMIT_SHA")',
    );
    expect(validation).not.toMatch(/git diff-tree[^\n]*\|\s*while\s+read/);
  });

  it("fails deployment validation when the scan finds a candidate", () => {
    expect(validation).toContain("SECRETS_FOUND=true");
    expect(validation).toContain('if [ "$SECRETS_FOUND" = "true" ]');
    expect(validation).toContain("DEPLOYABLE=false");
    expect(validation).toContain("exit 1");
  });
});
