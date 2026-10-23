import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const CANONICAL = process.env.GITHUB_REPOSITORY ?? "Sottara-Labs/sottara";
const FORBIDDEN = /Stellar-hush|Stellar-sottara/;

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf-8");
}

const DOCS = readdirSync(join(ROOT, "docs"), { recursive: true, encoding: "utf-8" })
  .filter((entry) => entry.endsWith(".md"))
  .map((entry) => join("docs", entry));

const IDENTITY_FILES = [
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  ".github/ISSUE_TEMPLATE/config.yml",
  "stellar-hush-api-100-issue-drafts.json",
  "src/components/landing/HushShowcase.tsx",
];

describe("repository identity", () => {
  it(`names no repository other than ${CANONICAL}`, () => {
    for (const file of [...IDENTITY_FILES, ...DOCS]) {
      expect(read(file), file).not.toMatch(FORBIDDEN);
    }
  });

  it("points the README badge and status link at the canonical repository", () => {
    const readme = read("README.md");
    expect(readme).toContain(`https://github.com/${CANONICAL}/actions/workflows/ci.yml`);
    expect(readme).not.toMatch(FORBIDDEN);
  });

  it("documents clone commands against the canonical repository", () => {
    expect(read("README.md")).toContain(`git clone https://github.com/${CANONICAL}.git`);
    expect(read("CONTRIBUTING.md")).toContain(`git clone https://github.com/${CANONICAL}.git`);
    expect(read("CONTRIBUTING.md")).toContain("cd sottara");
  });

  it("points security reporting at the canonical repository", () => {
    const advisory = `https://github.com/${CANONICAL}/security/advisories/new`;
    expect(read("SECURITY.md")).toContain(advisory);
    expect(read(".github/ISSUE_TEMPLATE/config.yml")).toContain(advisory);
  });
});
