import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/beta-live-testnet.yml"),
  "utf8",
);
const integrationJob = workflow.slice(
  workflow.indexOf("  beta-soroban-live:\n"),
  workflow.indexOf("  beta-live-workflow2:\n"),
);

describe("Soroban live Stellar CLI pin", () => {
  it("records an exact version and checksum", () => {
    expect(workflow).toContain('STELLAR_CLI_VERSION: "28.1.0"');
    expect(workflow).toContain(
      'STELLAR_CLI_SHA256: "c1680deee94301d33ada7a17f98411e642a4248c727afbd2e43050d345746462"',
    );
    expect(workflow).not.toContain("releases/latest");
  });

  it("verifies the pinned archive before extracting it", () => {
    expect(integrationJob).toContain(
      "stellar-cli-${STELLAR_CLI_VERSION}-x86_64-unknown-linux-gnu.tar.gz",
    );
    expect(integrationJob).toContain(
      'echo "$STELLAR_CLI_SHA256  $archive" | sha256sum --check --status',
    );
    expect(integrationJob).toContain('tar -xzf "$archive" -C /usr/local/bin');
  });

  it("records the resolved CLI version in the job summary", () => {
    expect(integrationJob).toContain("stellar --version");
    expect(integrationJob).toContain('>> "$GITHUB_STEP_SUMMARY"');
  });
});
