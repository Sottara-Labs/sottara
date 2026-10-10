import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/ci.yml"), "utf8");
const e2eJob = workflow.slice(workflow.indexOf("  e2e:\n"), workflow.indexOf("  visual-e2e:\n"));

describe("E2E workflow timeouts", () => {
  it("bounds the whole E2E job below GitHub's default timeout", () => {
    expect(e2eJob).toMatch(/\n {4}timeout-minutes: (?:[1-9]|[12]\d|30)\n/);
  });

  it("bounds Playwright browser installation and keeps the E2E command", () => {
    expect(e2eJob).toContain(
      "      - name: Install Playwright browsers\n        timeout-minutes: 15\n",
    );
    expect(e2eJob).toContain("run: ./node_modules/.bin/playwright install chromium --with-deps");
    expect(e2eJob).toContain("run: bun run test:e2e");
  });
});
