import { beforeEach, describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";

import { Route as KeysIndexRoute } from "../../../src/routes/api/v1/identity/keys/index";
import { Route as KeyDetailRoute } from "../../../src/routes/api/v1/identity/keys/$keyId";
import { Route as RotateKeyRoute } from "../../../src/routes/api/v1/identity/keys/rotate";
import { Route as RetireKeyRoute } from "../../../src/routes/api/v1/identity/keys/retire";
import { Route as RevokeKeyRoute } from "../../../src/routes/api/v1/identity/keys/revoke";
import { ACTOR_HEADER } from "../../../src/server/api/actor";
import { getApiContext } from "../../../src/server/api/context";
import { buildKeyPublicationSigningPayload } from "../../../src/features/identity/keys";
import type { MemoryApiRepository } from "../../../src/server/api/memory-repository";

const ownerKeypair = Keypair.random();
const owner = ownerKeypair.publicKey();
const attackerKeypair = Keypair.random();
const attacker = attackerKeypair.publicKey();

const defaultNotBefore = "2026-01-01T00:00:00.000Z";
const defaultNotAfter = "2027-01-01T00:00:00.000Z";

function signPublish(
  keypair: Keypair,
  keyId: string,
  publicKey: string,
  purpose: "signing" | "encryption" = "signing",
  version = 1,
  notBefore = defaultNotBefore,
  notAfter = defaultNotAfter,
) {
  const payload = buildKeyPublicationSigningPayload({
    owner: keypair.publicKey(),
    keyId,
    algorithm: "ed25519",
    purpose,
    publicKey,
    version,
    notBefore,
    notAfter,
    operation: "publish",
  });
  return keypair.sign(Buffer.from(payload)).toString("base64");
}

function signRotate(
  keypair: Keypair,
  newKeyId: string,
  newPublicKey: string,
  purpose: "signing" | "encryption" = "signing",
  version = 2,
  notBefore = defaultNotBefore,
  notAfter = defaultNotAfter,
) {
  const payload = buildKeyPublicationSigningPayload({
    owner: keypair.publicKey(),
    keyId: newKeyId,
    algorithm: "ed25519",
    purpose,
    publicKey: newPublicKey,
    version,
    notBefore,
    notAfter,
    operation: "rotate",
  });
  return keypair.sign(Buffer.from(payload)).toString("base64");
}

const getKeysHandler = (KeysIndexRoute.options as any).server?.handlers?.GET;
const publishKeyHandler = (KeysIndexRoute.options as any).server?.handlers?.POST;
const getKeyDetailHandler = (KeyDetailRoute.options as any).server?.handlers?.GET;
const rotateKeyHandler = (RotateKeyRoute.options as any).server?.handlers?.POST;
const retireKeyHandler = (RetireKeyRoute.options as any).server?.handlers?.POST;
const revokeKeyHandler = (RevokeKeyRoute.options as any).server?.handlers?.POST;

describe("Identity Key Lifecycle API Routes", () => {
  let repository: MemoryApiRepository;

  beforeEach(async () => {
    process.env.STEALTH_AUTH_ALLOW_HEADER_ONLY = "1";
    delete process.env.STEALTH_AUTH_REQUIRE_SIGNED;
    delete (globalThis as any).__stealthApiRepository;
    const ctx = await getApiContext();
    repository = ctx.repository as unknown as MemoryApiRepository;
  });

  describe("POST /api/v1/identity/keys (publishKey)", () => {
    it("successfully publishes a new public key for the authenticated actor", async () => {
      const keyId = "test-pub-key-1";
      const pubKey = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0";
      const signature = signPublish(ownerKeypair, keyId, pubKey, "signing", 1);

      const req = new Request("https://stealth.test/api/v1/identity/keys", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [ACTOR_HEADER]: owner,
        },
        body: JSON.stringify({
          keyId,
          algorithm: "ed25519",
          purpose: "signing",
          publicKey: pubKey,
          notBefore: defaultNotBefore,
          notAfter: defaultNotAfter,
          signature,
        }),
      });

      const res = await publishKeyHandler({ request: req });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.data.owner).toBe(owner);
      expect(data.data.status).toBe("active");
      expect(data.data.algorithm).toBe("ed25519");
      expect(data.data.keyId).toBe(keyId);
    });

    it("rejects publication without actor header with 401 unauthorized", async () => {
      const keyId = "test-pub-key-unauth";
      const pubKey = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0";
      const signature = signPublish(ownerKeypair, keyId, pubKey);

      const req = new Request("https://stealth.test/api/v1/identity/keys", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          keyId,
          algorithm: "ed25519",
          purpose: "signing",
          publicKey: pubKey,
          notBefore: defaultNotBefore,
          notAfter: defaultNotAfter,
          signature,
        }),
      });

      const res = await publishKeyHandler({ request: req });
      expect(res.status).toBe(401);
    });

    it("rejects publication with invalid actor format with 401 unauthorized", async () => {
      const keyId = "test-pub-key-invalid-actor";
      const pubKey = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0";
      const signature = signPublish(ownerKeypair, keyId, pubKey);

      const req = new Request("https://stealth.test/api/v1/identity/keys", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [ACTOR_HEADER]: "invalid-stellar-key",
        },
        body: JSON.stringify({
          keyId,
          algorithm: "ed25519",
          purpose: "signing",
          publicKey: pubKey,
          notBefore: defaultNotBefore,
          notAfter: defaultNotAfter,
          signature,
        }),
      });

      const res = await publishKeyHandler({ request: req });
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/v1/identity/keys (getKeyDirectory)", () => {
    it("returns directory of published keys when owner is query parameter", async () => {
      // First publish a key
      const keyId = "test-pub-key-dir";
      const pubKey = "pubkey-content-1";
      const signature = signPublish(ownerKeypair, keyId, pubKey, "encryption", 1);

      const pubReq = new Request("https://stealth.test/api/v1/identity/keys", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [ACTOR_HEADER]: owner,
        },
        body: JSON.stringify({
          keyId,
          algorithm: "ed25519",
          purpose: "encryption",
          publicKey: pubKey,
          notBefore: defaultNotBefore,
          notAfter: defaultNotAfter,
          signature,
        }),
      });
      await publishKeyHandler({ request: pubReq });

      const req = new Request(`https://stealth.test/api/v1/identity/keys?owner=${owner}`, {
        method: "GET",
      });
      const res = await getKeysHandler({ request: req });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.owner).toBe(owner);
      expect(data.data.allKeys.length).toBeGreaterThanOrEqual(1);
    });

    it("returns 400 bad request when owner parameter is missing", async () => {
      const req = new Request("https://stealth.test/api/v1/identity/keys", {
        method: "GET",
      });
      const res = await getKeysHandler({ request: req });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/v1/identity/keys/$keyId (getKey)", () => {
    it("returns specific key details when key exists", async () => {
      const keyId = "test-pub-key-detail";
      const pubKey = "pubkey-content-detail";
      const signature = signPublish(ownerKeypair, keyId, pubKey, "encryption", 1);

      const pubReq = new Request("https://stealth.test/api/v1/identity/keys", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [ACTOR_HEADER]: owner,
        },
        body: JSON.stringify({
          keyId,
          algorithm: "ed25519",
          purpose: "encryption",
          publicKey: pubKey,
          notBefore: defaultNotBefore,
          notAfter: defaultNotAfter,
          signature,
        }),
      });
      const pubRes = await publishKeyHandler({ request: pubReq });
      const pubData = await pubRes.json();
      expect(pubData.data.keyId).toBe(keyId);

      const req = new Request(`https://stealth.test/api/v1/identity/keys/${keyId}?owner=${owner}`, {
        method: "GET",
      });
      const res = await getKeyDetailHandler({ request: req, params: { keyId } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.keyId).toBe(keyId);
      expect(data.data.publicKey).toBe("pubkey-content-detail");
    });

    it("returns 404 not found when keyId does not exist", async () => {
      const req = new Request(`https://stealth.test/api/v1/identity/keys/nonexistent?owner=${owner}`, {
        method: "GET",
      });
      const res = await getKeyDetailHandler({ request: req, params: { keyId: "nonexistent" } });
      expect(res.status).toBe(404);
    });

    it("returns 400 bad request when owner parameter is missing", async () => {
      const req = new Request("https://stealth.test/api/v1/identity/keys/someKey", {
        method: "GET",
      });
      const res = await getKeyDetailHandler({ request: req, params: { keyId: "someKey" } });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/v1/identity/keys/rotate (rotateKey)", () => {
    it("successfully rotates an active key to a new one", async () => {
      const keyId = "key-to-rotate";
      const initialPubKey = "initial-pubkey";
      const pubSig = signPublish(ownerKeypair, keyId, initialPubKey, "signing", 1);

      const pubReq = new Request("https://stealth.test/api/v1/identity/keys", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [ACTOR_HEADER]: owner,
        },
        body: JSON.stringify({
          keyId,
          algorithm: "ed25519",
          purpose: "signing",
          publicKey: initialPubKey,
          notBefore: defaultNotBefore,
          notAfter: defaultNotAfter,
          signature: pubSig,
        }),
      });
      const pubRes = await publishKeyHandler({ request: pubReq });
      expect(pubRes.status).toBe(201);

      const newKeyId = "rotated-new-key";
      const newPubKey = "rotated-new-pubkey";
      const newKeySig = signPublish(ownerKeypair, newKeyId, newPubKey, "signing", 2);
      const rotateSig = signRotate(ownerKeypair, newKeyId, newPubKey, "signing", 2);

      const rotateReq = new Request("https://stealth.test/api/v1/identity/keys/rotate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [ACTOR_HEADER]: owner,
        },
        body: JSON.stringify({
          currentKeyId: keyId,
          newKey: {
            keyId: newKeyId,
            algorithm: "ed25519",
            purpose: "signing",
            publicKey: newPubKey,
            notBefore: defaultNotBefore,
            notAfter: defaultNotAfter,
            signature: newKeySig,
          },
          signature: rotateSig,
        }),
      });

      const res = await rotateKeyHandler({ request: rotateReq });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.current.keyId).toBe(newKeyId);
      expect(data.data.current.status).toBe("active");
      expect(data.data.previous.status).toBe("rotated");
    });

    it("rejects rotation without actor header with 401 unauthorized", async () => {
      const rotateReq = new Request("https://stealth.test/api/v1/identity/keys/rotate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          currentKeyId: "key-123",
          newKey: {
            algorithm: "ed25519",
            purpose: "signing",
            publicKey: "rotated-new-pubkey",
            signature: "valid-sig-2",
          },
          signature: "rotation-assertion-sig",
        }),
      });

      const res = await rotateKeyHandler({ request: rotateReq });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/v1/identity/keys/retire (retireKey)", () => {
    it("successfully marks a key as retired", async () => {
      const keyId = "key-to-retire";
      const pubKey = "retire-target-pubkey";
      const signature = signPublish(ownerKeypair, keyId, pubKey, "signing", 1);

      const pubReq = new Request("https://stealth.test/api/v1/identity/keys", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [ACTOR_HEADER]: owner,
        },
        body: JSON.stringify({
          keyId,
          algorithm: "ed25519",
          purpose: "signing",
          publicKey: pubKey,
          notBefore: defaultNotBefore,
          notAfter: defaultNotAfter,
          signature,
        }),
      });
      const pubRes = await publishKeyHandler({ request: pubReq });
      expect(pubRes.status).toBe(201);

      const retireReq = new Request("https://stealth.test/api/v1/identity/keys/retire", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [ACTOR_HEADER]: owner,
        },
        body: JSON.stringify({
          keyId,
          reason: "Periodic scheduled retirement",
        }),
      });

      const res = await retireKeyHandler({ request: retireReq });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.status).toBe("retired");
    });

    it("rejects retirement without actor header with 401 unauthorized", async () => {
      const req = new Request("https://stealth.test/api/v1/identity/keys/retire", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          keyId: "some-key",
          reason: "unauthorized attempt",
        }),
      });

      const res = await retireKeyHandler({ request: req });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/v1/identity/keys/revoke (revokeKey)", () => {
    it("successfully revokes an active key with revocation reason", async () => {
      const keyId = "key-to-revoke";
      const pubKey = "revoke-target-pubkey";
      const signature = signPublish(ownerKeypair, keyId, pubKey, "signing", 1);

      const pubReq = new Request("https://stealth.test/api/v1/identity/keys", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [ACTOR_HEADER]: owner,
        },
        body: JSON.stringify({
          keyId,
          algorithm: "ed25519",
          purpose: "signing",
          publicKey: pubKey,
          notBefore: defaultNotBefore,
          notAfter: defaultNotAfter,
          signature,
        }),
      });
      const pubRes = await publishKeyHandler({ request: pubReq });
      expect(pubRes.status).toBe(201);

      const revokeReq = new Request("https://stealth.test/api/v1/identity/keys/revoke", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [ACTOR_HEADER]: owner,
        },
        body: JSON.stringify({
          keyId,
          reason: "Key compromised by developer mistake",
          signature: "revocation-assertion-sig",
        }),
      });

      const res = await revokeKeyHandler({ request: revokeReq });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.status).toBe("revoked");
      expect(data.data.revocationReason).toBe("Key compromised by developer mistake");
    });

    it("rejects revocation without actor header with 401 unauthorized", async () => {
      const req = new Request("https://stealth.test/api/v1/identity/keys/revoke", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          keyId: "some-key",
          reason: "unauthorized attempt",
          signature: "sig",
        }),
      });

      const res = await revokeKeyHandler({ request: req });
      expect(res.status).toBe(401);
    });
  });
});
