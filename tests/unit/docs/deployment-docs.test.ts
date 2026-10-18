import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const DEPLOYMENT_DOCS = readdirSync(join(ROOT, "docs/deployment"), {
  recursive: true,
  encoding: "utf-8",
})
  .filter((entry) => entry.endsWith(".md"))
  .map((entry) => join("docs/deployment", entry));

// Gitignored CI artifacts produced at runtime and documented as such.
const RUNTIME_ARTIFACTS = ["release-gate-summary"];

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf-8");
}

describe("deployment docs", () => {
  it("prints the redacted configuration matrix exactly once", () => {
    const headerRows =
      read("docs/deployment/README.md").match(/^\| Variable\s+\| Domain\s+\| Visibility /gm) ?? [];
    expect(headerRows).toHaveLength(1);
  });

  it("references only committed rc-evidence files", () => {
    for (const file of DEPLOYMENT_DOCS) {
      for (const match of read(file).matchAll(/rc-evidence\/[A-Za-z0-9_.-]+/g)) {
        const name = match[0].replace("rc-evidence/", "");
        if (RUNTIME_ARTIFACTS.some((artifact) => name.startsWith(artifact))) continue;
        expect(existsSync(join(ROOT, "docs/deployment", match[0])), `${file} -> ${match[0]}`).toBe(
          true,
        );
      }
    }
  });

  it("resolves the relative markdown links", () => {
    for (const file of DEPLOYMENT_DOCS) {
      for (const match of read(file).matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = match[1];
        if (/^[a-z]+:/i.test(target) || target.startsWith("#")) continue;
        const resolved = resolve(ROOT, dirname(file), decodeURIComponent(target.split("#")[0]));
        expect(existsSync(resolved), `${file} -> ${target}`).toBe(true);
      }
    }
  });
});
