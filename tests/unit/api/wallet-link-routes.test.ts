import { beforeEach, describe, expect, it } from "vitest";

import { Route as WalletLinkIndexRoute } from "../../../src/routes/api/v1/wallet/link/index";
import { Route as WalletLinkChallengeRoute } from "../../../src/routes/api/v1/wallet/link/challenge";
import { Route as WalletLinkVerifyRoute } from "../../../src/routes/api/v1/wallet/link/verify";
import { ACTOR_HEADER } from "../../../src/server/api/actor";
import { getApiContext } from "../../../src/server/api/context";
import type { MemoryApiRepository } from "../../../src/server/api/memory-repository";

const owner = `G${"A".repeat(55)}`;
const externalWallet = `G${"B".repeat(55)}`;
const testNetwork = "Test SDF Network ; September 2015";

const listWalletsHandler = (WalletLinkIndexRoute.options as any).server?.handlers?.GET;
const createChallengeHandler = (WalletLinkChallengeRoute.options as any).server?.handlers?.POST;
const verifyChallengeHandler = (WalletLinkVerifyRoute.options as any).server?.handlers?.POST;

describe("Wallet Link API Routes", () => {
  let repository: MemoryApiRepository;

  beforeEach(async () => {
    process.env.STEALTH_AUTH_ALLOW_HEADER_ONLY = "1";
    delete process.env.STEALTH_AUTH_REQUIRE_SIGNED;
    delete (globalThis as any).__stealthApiRepository;
    const ctx = await getApiContext();
    repository = ctx.repository as unknown as MemoryApiRepository;
  });

  describe("POST /api/v1/wallet/link/challenge (createChallenge)", () => {
    it("successfully creates a wallet linking challenge for authenticated actor", async () => {
      const req = new Request("https://stealth.test/api/v1/wallet/link/challenge", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [ACTOR_HEADER]: owner,
        },
        body: JSON.stringify({
          address: externalWallet,
          network: testNetwork,
        }),
      });

      const res = await createChallengeHandler({ request: req });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.challenge).toBeDefined();
      expect(typeof data.data.challenge).toBe("string");
      expect(data.data.expiresAt).toBeDefined();
    });

    it("rejects challenge creation without actor header with 401 unauthorized", async () => {
      const req = new Request("https://stealth.test/api/v1/wallet/link/challenge", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          address: externalWallet,
          network: testNetwork,
        }),
      });

      const res = await createChallengeHandler({ request: req });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/v1/wallet/link/verify (verifyChallenge)", () => {
    it("successfully verifies challenge and links external wallet", async () => {
      // 1. Issue challenge
      const chalReq = new Request("https://stealth.test/api/v1/wallet/link/challenge", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [ACTOR_HEADER]: owner,
        },
        body: JSON.stringify({
          address: externalWallet,
          network: testNetwork,
        }),
      });
      await createChallengeHandler({ request: chalReq });

      // 2. Verify with signature
      const verifyReq = new Request("https://stealth.test/api/v1/wallet/link/verify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [ACTOR_HEADER]: owner,
        },
        body: JSON.stringify({
          address: externalWallet,
          signature: "valid-wallet-signature",
          capabilities: ["sign", "send"],
          network: testNetwork,
        }),
      });

      const res = await verifyChallengeHandler({ request: verifyReq });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.address).toBe(externalWallet);
      expect(data.data.capabilities).toEqual(["sign", "send"]);
    });

    it("rejects replayed challenge handshake with 400 error (cannot be verified twice)", async () => {
      // 1. Issue challenge
      const chalReq = new Request("https://stealth.test/api/v1/wallet/link/challenge", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [ACTOR_HEADER]: owner,
        },
        body: JSON.stringify({
          address: externalWallet,
          network: testNetwork,
        }),
      });
      await createChallengeHandler({ request: chalReq });

      // 2. First verify (consumes challenge)
      const verifyReq1 = new Request("https://stealth.test/api/v1/wallet/link/verify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [ACTOR_HEADER]: owner,
        },
        body: JSON.stringify({
          address: externalWallet,
          signature: "valid-wallet-signature",
          capabilities: ["sign"],
          network: testNetwork,
        }),
      });
      const res1 = await verifyChallengeHandler({ request: verifyReq1 });
      expect(res1.status).toBe(200);

      // 3. Second verify (replayed attempt without fresh challenge)
      const verifyReq2 = new Request("https://stealth.test/api/v1/wallet/link/verify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [ACTOR_HEADER]: owner,
        },
        body: JSON.stringify({
          address: externalWallet,
          signature: "valid-wallet-signature",
          capabilities: ["sign"],
          network: testNetwork,
        }),
      });
      const res2 = await verifyChallengeHandler({ request: verifyReq2 });
      expect(res2.status).toBe(400);
      const err = await res2.json();
      expect(err.error.message).toContain("no_challenge_found");
    });

    it("rejects verification without actor header with 401 unauthorized", async () => {
      const verifyReq = new Request("https://stealth.test/api/v1/wallet/link/verify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          address: externalWallet,
          signature: "some-sig",
          capabilities: ["sign"],
          network: testNetwork,
        }),
      });

      const res = await verifyChallengeHandler({ request: verifyReq });
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/v1/wallet/link (listExternalWallets)", () => {
    it("successfully lists linked wallets for authenticated actor", async () => {
      // 1. Create and verify link
      const chalReq = new Request("https://stealth.test/api/v1/wallet/link/challenge", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [ACTOR_HEADER]: owner,
        },
        body: JSON.stringify({
          address: externalWallet,
          network: testNetwork,
        }),
      });
      await createChallengeHandler({ request: chalReq });

      const verifyReq = new Request("https://stealth.test/api/v1/wallet/link/verify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [ACTOR_HEADER]: owner,
        },
        body: JSON.stringify({
          address: externalWallet,
          signature: "wallet-sig",
          capabilities: ["sign", "send"],
          network: testNetwork,
        }),
      });
      await verifyChallengeHandler({ request: verifyReq });

      // 2. List wallets
      const listReq = new Request("https://stealth.test/api/v1/wallet/link", {
        method: "GET",
        headers: {
          [ACTOR_HEADER]: owner,
        },
      });

      const res = await listWalletsHandler({ request: listReq });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.wallets.length).toBeGreaterThanOrEqual(1);
      expect(data.data.wallets[0].address).toBe(externalWallet);
    });

    it("rejects listing wallets without actor header with 401 unauthorized", async () => {
      const listReq = new Request("https://stealth.test/api/v1/wallet/link", {
        method: "GET",
      });

      const res = await listWalletsHandler({ request: listReq });
      expect(res.status).toBe(401);
    });
  });
});
