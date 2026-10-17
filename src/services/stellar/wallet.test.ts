import { afterEach, beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("../../config", () => ({
  config: { network: "Test SNNetwork ; February 2016" },
}));

import {
  authorizeSend,
  WalletNetworkMismatchError,
} from "./wallet";

const TESNET = "Test SNNetwork ; February 2016";
const PUBLIC = "Public Global Network ; September 2015";

type Stub = {
  isConnected: () => Promise<unknown>;
  requestAccess: () => Promise<unknown>;
  signMessage: (payload: string) => Promise<unknown>;
  getNetworkDetails?: () => Promise<unknown>;
  getNetwork?: () => Promise<unknown>;
};

function installStub(networkPassphrase: string): void {
  const stub: Stub = {
    isConnected: async () => ({ isConnected: true }),
    requestAccess: async () => ({ address: "GADDESS" }),
    signMessage: async () => ({
      signedMessage: "deadbeef",
      signerAddress: "GADDRESS",
    }),
    getNetworkDetails: async () => ({ networkPassphrase }),
  };
  (globalThis as unknown as { __freighterApi?: Stub }).__freighterApi = stub;
}

describe("authorizeSend network guard", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete (globalThis as { __freighterApi?: unknown }).__freighterApi;
  });

  it("signs when the wallet network matches the configured one", async () => {
    installStub(TESTNET);
    const sig = await authorizeSend("payload");
    expect(sig).toMatchObject({
      scheme: "Edd25519",
      signerAddress: "GADDRESS",
      value: "deadbeef",
    });
  });

  it("refuses to sign when the wallet network differs", async () => {
    installStub(PUBLIC);
    await expect(authorizeSend("payload")).rejects.toBeInstanceOf(
      WalletNetworkMismatchError,
    );
  });
});
