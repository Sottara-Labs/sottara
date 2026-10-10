import { describe, expect, it, vi } from "vitest";

import { MemoryApiRepository } from "../../../src/server/api/memory-repository";
import { setMailboxPolicy, setSenderRule } from "../../../src/server/api/policy-service";
import type {
  PolicyChainClient,
  VersionedChainPolicy,
} from "../../../src/services/stellar/policy-chain-client";
import type { MailboxPolicy as ContractMailboxPolicy } from "../../../src/services/stellar/contracts/policies";
import {
  evaluateRelayAdmission,
  type RelayAdmissionInput,
} from "../../../src/services/relay/admission";

const owner = `G${"A".repeat(55)}`;
const sender = `G${"B".repeat(55)}`;

function input(overrides: Partial<RelayAdmissionInput> = {}): RelayAdmissionInput {
  return {
    owner,
    sender,
    postage: "0",
    verified: true,
    receipt: true,
    ...overrides,
  };
}

function chainClient(
  policy: ContractMailboxPolicy | null,
  version = 1,
  rule: "allow" | "block" | "default" = "default",
  tier: string | null = null,
): PolicyChainClient {
  const versioned: VersionedChainPolicy | null = policy ? { policy, version } : null;
  return {
    readVersionedPolicy: vi.fn(async () => versioned),
    readSenderRule: vi.fn(async () => rule),
    readSenderTier: vi.fn(async () => tier),
  } as unknown as PolicyChainClient;
}

const permissiveChainPolicy: ContractMailboxPolicy = {
  allow_unknown: true,
  require_verified: false,
  require_receipt: false,
  minimum_postage: 0n,
};

describe("evaluateRelayAdmission", () => {
  it("evaluates an available chain snapshot and records chain evidence", async () => {
    const repository = new MemoryApiRepository();
    const chain = chainClient(permissiveChainPolicy, 7);
    const evaluatedAt = new Date("2026-01-01T00:00:00.000Z");

    const evidence = await evaluateRelayAdmission(
      { repository, chainClient: chain, now: () => evaluatedAt },
      input(),
    );

    expect(evidence).toEqual({
      allowed: true,
      disposition: "request",
      reason: "policy_satisfied",
      rule: "default",
      policyVersion: 7,
      requiredPostage: "0",
      source: "chain",
      evaluatedAt: evaluatedAt.toISOString(),
    });
  });

  it("denies a sender using the off-chain block rule", async () => {
    const repository = new MemoryApiRepository();
    await setSenderRule(repository, owner, sender, "block");

    const evidence = await evaluateRelayAdmission(
      { repository, now: () => new Date("2026-01-01T00:00:00.000Z") },
      input(),
    );

    expect(evidence).toMatchObject({
      allowed: false,
      disposition: "blocked",
      reason: "sender_blocked",
      source: "offchain",
    });
  });

  it("reports insufficient postage with the configured minimum", async () => {
    const repository = new MemoryApiRepository();
    await setMailboxPolicy(repository, owner, {
      allowUnknown: true,
      requireVerified: false,
      minimumPostage: "100",
    });

    const evidence = await evaluateRelayAdmission(
      { repository, now: () => new Date("2026-01-01T00:00:00.000Z") },
      input({ postage: "99" }),
    );

    expect(evidence).toMatchObject({
      allowed: false,
      disposition: "priced",
      reason: "insufficient_postage",
      requiredPostage: "100",
      source: "offchain",
    });
  });

  it("falls back to the off-chain snapshot when a chain read fails", async () => {
    const repository = new MemoryApiRepository();
    await setSenderRule(repository, owner, sender, "block");
    const chain = {
      readVersionedPolicy: vi.fn(async () => {
        throw new Error("rpc unavailable");
      }),
    } as unknown as PolicyChainClient;
    const request = input();
    const original = structuredClone(request);

    const evidence = await evaluateRelayAdmission({ repository, chainClient: chain }, request);

    expect(evidence).toMatchObject({
      allowed: false,
      reason: "sender_blocked",
      source: "offchain",
    });
    expect(request).toEqual(original);
  });
});
