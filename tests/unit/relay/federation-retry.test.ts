import { describe, expect, it, vi } from "vitest";

import {
  FederationDeliveryService,
  mapRelayStateToMessageDeliveryState,
  type FederationMessage,
  type RelayNode,
} from "../../../src/services/relay/federation";

const node: RelayNode = {
  domain: "relay.example",
  endpoint: "https://relay.example/api/v1/relay",
  publicKey: "relay-key",
};

const baseMessage: FederationMessage = {
  id: "message-retry",
  recipientDomain: node.domain,
  payload: "encrypted-payload",
  expiryTimestamp: Date.now() + 60_000,
};

describe("FederationDeliveryService retry classification", () => {
  it("reports retry exhaustion as failed, not expired", async () => {
    const service = new FederationDeliveryService(
      async () => node,
      async () => ({ status: 500 }),
    );
    vi.spyOn(service as any, "delay").mockResolvedValue(undefined);

    const result = await service.deliver(baseMessage);

    expect(result).toMatchObject({
      state: "DEAD_LETTER",
      attempts: 5,
      errorCode: "ERR_DELIVERY_RETRIES_EXHAUSTED",
    });
    expect(mapRelayStateToMessageDeliveryState(result.state, result.errorCode)).toBe("failed");
  });

  it("keeps an already expired message classified as expired", async () => {
    const resolveRelay = vi.fn(async () => node);
    const service = new FederationDeliveryService(resolveRelay, async () => ({ status: 500 }));

    const result = await service.deliver({
      ...baseMessage,
      id: "message-expired",
      expiryTimestamp: Date.now() - 1,
    });

    expect(result).toMatchObject({
      state: "DEAD_LETTER",
      attempts: 0,
      errorCode: "ERR_DELIVERY_EXPIRED",
    });
    expect(mapRelayStateToMessageDeliveryState(result.state, result.errorCode)).toBe("expired");
    expect(resolveRelay).not.toHaveBeenCalled();
  });
});
