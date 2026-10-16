import { describe, expect, it } from "vitest";

import {
  PolicyChainUnavailableError,
  isPolicyChainUnavailableError,
  InMemoryPolicyChainClient,
} from "./policy-chain-client";

const owner = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const sender = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

describe("InMemoryPolicyChainClient", () => {
  it("returns null when no policy is seeded", () => {
    const client = new InMemoryPolicyChainClient();
    expect(client.readVersionedPolicy(owner)).resolves.toBeNull();
  });

  it("returns the default sender rule when none is seeded", () => {
    const client = new InMemoryPolicyChainClient();
    expect(client.readSenderRule(owner, sender)).resolves.toEqual("default");
  });

  it("returns null when no sender tier is seeded", () => {
    const client = new InMemoryPolicyChainClient();
    expect(client.readSenderTier(owner, sender)).resolves.toBeNull();
  });

  it("fails closed with a retryable error when the RPC is unavailable", async () => {
    const client = new InMemoryPolicyChainClient();
    client.unavailable = true;

    await expect(client.readVersionedPolicy(owner)).rejects.toThrow(PolicyChainUnavailableError);
    await expect(client.readSenderRule(owner, sender)).rejects.toThrow(PolicyChainUnavailableError);
    await expect(client.readSenderTier(owner, sender)).rejects.toThrow(PolicyChainUnavailableError);
  });

  it("marks the unavailable error as retryable", () => {
    const error = new PolicyChainUnavailableError("simulated outage");
    expect(error.retryable).toBe(true);
    expect(isPolicyChainUnavailableError(error)).toBe(true);
    expect(isPolicyChainUnavailableError(new Error("not found"))).toBe(false);
  });

  it("propagates the unavailable error through readMailboxPolicy", () => {
    const client = new InMemoryPolicyChainClient();
    client.unavailable = true;
    expect(client.readMailboxPolicy(owner)).rejects.toThrow(PolicyChainUnavailableError);
  });
});
