import { describe, expect, it } from "vitest";

import { resolveRelayNodeViaFederation } from "../../../src/services/relay/federation";

describe("resolveRelayNodeViaFederation", () => {
  it("uses the endpoint and public key returned by the resolver", async () => {
    const node = await resolveRelayNodeViaFederation("Relay.Example", {
      resolveRelay: async () => ({
        endpoint: "https://peer.example/relay",
        publicKey: "peer-public-key",
      }),
    });

    expect(node).toEqual({
      domain: "relay.example",
      endpoint: "https://peer.example/relay",
      publicKey: "peer-public-key",
    });
  });

  it("fails closed when the resolver misses, is unavailable, or returns an incomplete record", async () => {
    await expect(
      resolveRelayNodeViaFederation("missing.example", {
        resolveRelay: async () => null,
      }),
    ).resolves.toBeNull();
    await expect(resolveRelayNodeViaFederation("missing.example")).resolves.toBeNull();
    await expect(
      resolveRelayNodeViaFederation("broken.example", {
        resolveRelay: async () => {
          throw new Error("federation unavailable");
        },
      }),
    ).resolves.toBeNull();
    await expect(
      resolveRelayNodeViaFederation("incomplete.example", {
        resolveRelay: async () => ({ endpoint: "", publicKey: "" }),
      }),
    ).resolves.toBeNull();
  });
});
