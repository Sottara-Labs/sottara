import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const README = readFileSync(join(process.cwd(), "README.md"), "utf-8");

describe("README environment variables section", () => {
  it("does not document phantom SOTTARA_KV_* storage variables", () => {
    expect(README).not.toMatch(/SOTTARA_KV_/);
  });

  it("keeps the storage variables named the way the code reads them", () => {
    expect(README).toMatch(/STEALTH_KV_LOCAL_ID/);
    expect(README).toMatch(/STEALTH_KV_PREVIEW_ID/);
    expect(README).toMatch(/STEALTH_KV_PRODUCTION_ID/);
  });

  it("renders the environment variables as a single table", () => {
    const headers = README.match(/^\| Variable group/gm) ?? [];
    expect(headers).toHaveLength(1);
  });
});
