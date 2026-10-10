import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Admin filter controls keyboard focus visible styling (Issue #86)", () => {
  const adminIndexPath = resolve(process.cwd(), "src/routes/admin/index.tsx");
  const adminDlqPath = resolve(process.cwd(), "src/routes/admin/dlq.tsx");

  const adminIndexContent = readFileSync(adminIndexPath, "utf-8");
  const adminDlqContent = readFileSync(adminDlqPath, "utf-8");

  it("admin/index.tsx provides focus-visible ring on filter select control", () => {
    // Must contain select element with aria-label="Filter"
    expect(adminIndexContent).toContain('aria-label="Filter"');
    expect(adminIndexContent).toContain("focus-visible:ring-2");
    expect(adminIndexContent).toContain("focus-visible:ring-emerald-400");
    expect(adminIndexContent).toContain("focus-visible:ring-offset-2");
    // Preserves focus:outline-none for base styling
    expect(adminIndexContent).toContain("focus:outline-none");
  });

  it("admin/dlq.tsx provides focus-visible ring on job type and status filter selects", () => {
    expect(adminDlqContent).toContain("Filter Job Type");
    expect(adminDlqContent).toContain("Filter Status");
    expect(adminDlqContent).toMatch(/focus-visible:ring-2 focus-visible:ring-emerald-400/);
    expect(adminDlqContent).toContain("focus:outline-none");
  });
});
