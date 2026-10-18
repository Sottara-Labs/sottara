import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SKIP_DIRS = new Set([
  ".git",
  ".output",
  ".vinxi",
  ".wrangler",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);

function markdownFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...markdownFiles(join(dir, entry.name)));
    } else if (entry.name.endsWith(".md")) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

describe("markdown links", () => {
  it("resolves every relative link in every markdown file", () => {
    const files = markdownFiles(".");
    expect(files.length).toBeGreaterThan(100);

    const broken: string[] = [];
    for (const file of files) {
      const content = readFileSync(join(ROOT, file), "utf-8").replace(/```[\s\S]*?```/g, "");
      for (const match of content.matchAll(/\]\(([^)\s]+)\)/g)) {
        const rawTarget = match[1];
        if (/^[a-z][a-z0-9+.-]*:/i.test(rawTarget) || rawTarget.startsWith("#")) continue;
        const target = rawTarget.split("#")[0];
        if (!target) continue;
        const resolved = resolve(ROOT, dirname(file), decodeURIComponent(target));
        if (!existsSync(resolved)) broken.push(`${file} -> ${rawTarget}`);
      }
    }

    expect(broken).toEqual([]);
  });
});
