import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  REQUIRED_GATES,
  OPERATOR_GATES,
  MISSING_GATE_REASON,
  MISSING_OPERATOR_GATE_REASON,
  assembleGates,
  buildReleaseSummary,
  isReleasable,
  overallVerdict,
  sortGates,
} from "../../../scripts/ci/release-gate-lib.mjs";

function passingRequiredGates() {
  return REQUIRED_GATES.map((gateId) => ({
    gateId,
    name: gateId,
    owner: "test",
    dependency: "BETA-088",
    status: "pass",
  }));
}

describe("BETA-088 release-gate summary", () => {
  it("passes only when every required gate exists and passes", () => {
    const items = passingRequiredGates();
    expect(overallVerdict(items)).toBe("pass");
    expect(isReleasable(items)).toBe(true);
  });

  it("treats one missing required gate as fail and not releasable", () => {
    const loaded = passingRequiredGates().filter((g) => g.gateId !== "security");
    const { gates, missingRequiredGates } = assembleGates(loaded);
    expect(missingRequiredGates).toEqual(["security"]);
    expect(gates.find((g) => g.gateId === "security")?.status).toBe("fail");
    expect(gates.find((g) => g.gateId === "security")?.message).toBe(MISSING_GATE_REASON);
    expect(overallVerdict(gates)).toBe("fail");
    expect(isReleasable(gates)).toBe(false);
  });

  it("treats multiple missing required gates as fail", () => {
    const loaded = passingRequiredGates().filter(
      (g) => g.gateId !== "security" && g.gateId !== "provenance",
    );
    const { gates, missingRequiredGates } = assembleGates(loaded);
    expect(missingRequiredGates).toEqual(["security", "provenance"]);
    expect(overallVerdict(gates)).toBe("fail");
    expect(isReleasable(gates)).toBe(false);
  });

  it("returns blocked when a required gate is blocked", () => {
    const items = passingRequiredGates().map((g) =>
      g.gateId === "beta-security" ? { ...g, status: "blocked" } : g,
    );
    expect(overallVerdict(items)).toBe("blocked");
    expect(isReleasable(items)).toBe(false);
  });

  it("returns fail when a required gate failed", () => {
    const items = passingRequiredGates().map((g) =>
      g.gateId === "e2e" ? { ...g, status: "fail" } : g,
    );
    expect(overallVerdict(items)).toBe("fail");
    expect(isReleasable(items)).toBe(false);
  });

  it("fails the overall verdict when a PR-scoped gate like governance fails", () => {
    const items = [
      ...passingRequiredGates(),
      {
        gateId: "governance",
        name: "Governance Checks",
        owner: "platform/release",
        dependency: "BETA-088",
        status: "fail",
      },
    ];
    expect(overallVerdict(items)).toBe("fail");
  });

  it("never passes an empty result set", () => {
    expect(overallVerdict([])).toBe("fail");
    expect(isReleasable([])).toBe(false);
    const { gates } = assembleGates([]);
    expect(overallVerdict(gates)).toBe("fail");
    expect(gates).toHaveLength(REQUIRED_GATES.length);
  });

  it("does not treat fork-skipped security as releasable", () => {
    const items = passingRequiredGates().map((g) =>
      g.gateId === "security" ? { ...g, status: "skipped" } : g,
    );
    expect(overallVerdict(items, { forkPr: true })).toBe("pass");
    expect(isReleasable(items)).toBe(false);
  });

  it("keeps gate order deterministic for identical inputs", () => {
    const shuffled = [...passingRequiredGates()].reverse();
    const first = sortGates(shuffled).map((g) => g.gateId);
    const second = sortGates(shuffled).map((g) => g.gateId);
    expect(first).toEqual(second);
    expect(first).toEqual([...REQUIRED_GATES]);
  });

  it("writes a stable summary from the CLI for identical gate files", () => {
    const dir = mkdtempSync(join(tmpdir(), "release-gates-"));
    try {
      for (const gate of passingRequiredGates()) {
        writeFileSync(join(dir, `gate-result-${gate.gateId}.json`), JSON.stringify(gate));
      }
      execFileSync(
        process.execPath,
        ["scripts/ci/release-gate-summary.mjs", "--input-dir", dir, "--commit", "abc"],
        { cwd: process.cwd() },
      );
      const summary = JSON.parse(readFileSync(join(dir, "release-gate-summary.json"), "utf-8"));
      expect(summary.verdict).toBe("pass");
      expect(summary.releasable).toBe(true);
      expect(summary.gates.map((g: { gateId: string }) => g.gateId)).toEqual([...REQUIRED_GATES]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("builds a non-releasable summary when only client-checks is present", () => {
    const summary = buildReleaseSummary({
      loadedGates: [{ gateId: "client-checks", name: "Client Checks", status: "pass", owner: "x" }],
      commit: "deadbeef",
      toolVersions: { bun: "1.3.14" },
      artifactHashes: null,
      generatedAt: "2026-08-24T00:00:00.000Z",
    });
    expect(summary.verdict).toBe("fail");
    expect(summary.releasable).toBe(false);
    expect(summary.missingRequiredGates).toContain("security");
    expect(
      summary.failureOwnership.some((f: { message: string }) => f.message === MISSING_GATE_REASON),
    ).toBe(true);
  });

  it("requires every gate artifact uploaded by the release-gate workflows", () => {
    // Governance is PR-scoped by design: a recorded failure blocks, but it is
    // intentionally not part of the required set.
    const prScoped = new Set(["governance"]);
    const uploaded = new Set<string>();
    for (const file of [".github/workflows/ci.yml", ".github/workflows/beta-live-testnet.yml"]) {
      const text = readFileSync(join(process.cwd(), file), "utf-8");
      for (const line of text.split("\n")) {
        const match = line.match(/^\s*(?:path:\s*'?)?gate-result-([a-z0-9-]+)\.json'?,?\s*$/);
        if (match) uploaded.add(match[1]);
      }
    }
    const required = new Set<string>(REQUIRED_GATES);
    const missing = [...uploaded].filter((id) => !required.has(id) && !prScoped.has(id));
    expect(missing).toEqual([]);
  });

  it("keeps the ci.yml summary needs list in sync with the gate-uploading jobs", () => {
    const text = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf-8");
    const jobs = new Map<string, string[]>();
    let current: string | null = null;
    let inJobs = false;
    for (const line of text.split("\n")) {
      if (/^jobs:\s*$/.test(line)) {
        inJobs = true;
        continue;
      }
      if (!inJobs) continue;
      if (/^\S/.test(line)) break;
      const header = line.match(/^  ([A-Za-z][A-Za-z0-9_-]*):\s*$/);
      if (header) {
        current = header[1];
        jobs.set(current, []);
        continue;
      }
      if (current) jobs.get(current)!.push(line);
    }

    const summaryBody = jobs.get("release-gate-summary");
    expect(summaryBody).toBeDefined();
    const needsAt = summaryBody!.findIndex((line) => line.trim() === "needs:");
    expect(needsAt).toBeGreaterThanOrEqual(0);
    const needs = new Set<string>();
    for (let i = needsAt + 1; i < summaryBody!.length; i++) {
      const match = summaryBody![i].match(/^\s*- ([a-z0-9-]+)\s*$/);
      if (!match) break;
      needs.add(match[1]);
    }

    const producers = [...jobs.entries()]
      .filter(
        ([job, body]) =>
          job !== "release-gate-summary" && body.some((line) => /^\s+name: gate-/.test(line)),
      )
      .map(([job]) => job);
    expect(producers.length).toBeGreaterThanOrEqual(14);
    for (const job of producers) expect([...needs]).toContain(job);
  });

  it("does not fail the verdict when operator-triggered gates are absent", () => {
    const loaded = passingRequiredGates().filter((g) => !OPERATOR_GATES.includes(g.gateId));
    const summary = buildReleaseSummary({
      loadedGates: loaded,
      commit: "cafebabe",
      toolVersions: {},
      artifactHashes: null,
    });
    expect(summary.verdict).toBe("pass");
    expect(summary.releasable).toBe(false);
    const live = summary.gates.find((g: { gateId: string }) => g.gateId === "beta-soroban-live");
    expect(live?.status).toBe("skipped");
    expect(live?.message).toBe(MISSING_OPERATOR_GATE_REASON);
    expect(summary.missingRequiredGates).toEqual([...OPERATOR_GATES]);
  });

  it("blocks when an operator-triggered gate result is recorded as failed", () => {
    const loaded = passingRequiredGates().filter((g) => g.gateId !== "beta-soroban-live");
    loaded.push({
      gateId: "beta-soroban-live",
      name: "Soroban Live Integration",
      owner: "platform/contracts",
      dependency: "BETA-086",
      status: "fail",
    });
    const summary = buildReleaseSummary({
      loadedGates: loaded,
      commit: "cafebabe",
      toolVersions: {},
      artifactHashes: null,
    });
    expect(summary.verdict).toBe("fail");
    expect(summary.failureOwnership.map((f: { gateId: string }) => f.gateId)).toContain(
      "beta-soroban-live",
    );
  });
});
