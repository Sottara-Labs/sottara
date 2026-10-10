import { describe, expect, it } from "vitest";

import {
  FederationDeliveryService,
  type FederationMessage,
  type RelayNode,
} from "../../../src/services/relay/federation";

const relayNode: RelayNode = {
  domain: "relay.example",
  endpoint: "https://relay.example/api/v1/relay",
  publicKey: "relay-key",
};

function message(id: string): FederationMessage {
  return {
    id,
    recipientDomain: relayNode.domain,
    payload: "encrypted-payload",
    expiryTimestamp: Date.now() + 60_000,
  };
}

describe("FederationDeliveryService", () => {
  it("bounds the in-memory dedupe window and keeps recent ids", async () => {
    const service = new FederationDeliveryService(
      async () => relayNode,
      async () => ({ status: 200 }),
    );

    for (let i = 0; i < 10_005; i += 1) {
      const result = await service.deliver(message(`message-${i}`));
      expect(result.state).toBe("ACKNOWLEDGED");
    }

    const seen = (service as any).seenMessageIds as Set<string>;
    expect(seen.size).toBe(10_000);
    expect(seen.has("message-0")).toBe(false);
    expect(seen.has("message-4")).toBe(false);
    expect(seen.has("message-5")).toBe(true);
    expect(seen.has("message-10004")).toBe(true);
    expect((await service.deliver(message("message-10004"))).state).toBe("DEDUPLICATED");
  });
});
