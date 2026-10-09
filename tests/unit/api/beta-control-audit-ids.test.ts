import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BetaControlStore, MemoryPersistence } from "@/server/api/beta-controls/store";
import { CryptoIdError } from "@/services/crypto/random";
import { resetCryptoTestVectors } from "@/services/crypto/testing";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetCryptoTestVectors();
});

function makeStore() {
  const persistence = new MemoryPersistence();
  const save = vi.spyOn(persistence, "save");
  return { store: new BetaControlStore(persistence), persistence, save };
}

describe("beta control audit identifiers", () => {
  it("preserves UUID audit ids and persists the same identifier", async () => {
    const uuid = "123e4567-e89b-42d3-a456-426614174000";
    const randomUUID = vi.fn(() => uuid);
    const getRandomValues = vi.fn(webcrypto.getRandomValues.bind(webcrypto));
    vi.stubGlobal("crypto", { randomUUID, getRandomValues });
    const insecureRandom = vi.spyOn(Math, "random");
    const { store, persistence } = makeStore();

    await store.setKillSwitch("signup", "closed", { actor: "test-operator" });

    expect(store.getAudit()[0].id).toBe(`bca_${uuid}`);
    expect((await persistence.load())?.audit[0].id).toBe(`bca_${uuid}`);
    expect(randomUUID).toHaveBeenCalledOnce();
    expect(getRandomValues).not.toHaveBeenCalled();
    expect(insecureRandom).not.toHaveBeenCalled();
  });

  it("uses 128 secure random bits when randomUUID is unavailable", async () => {
    const getRandomValues = vi.fn(webcrypto.getRandomValues.bind(webcrypto));
    vi.stubGlobal("crypto", { getRandomValues });
    const insecureRandom = vi.spyOn(Math, "random");
    const { store, persistence } = makeStore();

    await store.setKillSwitch("signup", "closed", { actor: "test-operator" });

    expect(store.getAudit()[0].id).toMatch(/^bca_[0-9a-f]{32}$/);
    expect((await persistence.load())?.audit[0].id).toBe(store.getAudit()[0].id);
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(getRandomValues.mock.calls[0][0]).toHaveLength(16);
    expect(insecureRandom).not.toHaveBeenCalled();
  });

  it("also uses the secure fallback for a non-callable randomUUID property", async () => {
    vi.stubGlobal("crypto", {
      randomUUID: undefined,
      getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
    });
    const { store } = makeStore();

    await store.setKillSwitch("signup", "closed", { actor: "test-operator" });

    expect(store.getAudit()[0].id).toMatch(/^bca_[0-9a-f]{32}$/);
  });

  it("keeps rapid concurrent mutations distinct without Math.random", async () => {
    vi.stubGlobal("crypto", { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
    const insecureRandom = vi.spyOn(Math, "random");
    const { store } = makeStore();

    await Promise.all(
      Array.from({ length: 512 }, () =>
        store.setKillSwitch("signup", "closed", { actor: "test-operator" }),
      ),
    );

    const ids = store.getAudit().map((entry) => entry.id);
    expect(new Set(ids).size).toBe(512);
    expect(ids.every((id) => /^bca_[0-9a-f]{32}$/.test(id))).toBe(true);
    expect(store.getKillSwitch("signup")?.version).toBe(512);
    expect(insecureRandom).not.toHaveBeenCalled();
  });

  it.each([undefined, {}])(
    "rejects an unavailable CSPRNG (%j) without applying a mutation",
    async (crypto) => {
      vi.stubGlobal("crypto", crypto);
      const insecureRandom = vi.spyOn(Math, "random");
      const { store, save } = makeStore();

      await expect(
        store.setKillSwitch("signup", "closed", { actor: "test-operator" }),
      ).rejects.toBeInstanceOf(CryptoIdError);

      expect(store.getKillSwitch("signup")).toBeUndefined();
      expect(store.getAudit()).toEqual([]);
      expect(save).not.toHaveBeenCalled();
      expect(insecureRandom).not.toHaveBeenCalled();
    },
  );

  it.each(["randomUUID", "getRandomValues"])(
    "propagates %s failures without an insecure fallback",
    async (method) => {
      const error = new Error("secure random source failed");
      vi.stubGlobal("crypto", {
        [method]: () => {
          throw error;
        },
      });
      const insecureRandom = vi.spyOn(Math, "random");
      const { store, save } = makeStore();

      await expect(
        store.setKillSwitch("signup", "closed", { actor: "test-operator" }),
      ).rejects.toBe(error);

      expect(store.getKillSwitch("signup")).toBeUndefined();
      expect(store.getAudit()).toEqual([]);
      expect(save).not.toHaveBeenCalled();
      expect(insecureRandom).not.toHaveBeenCalled();
    },
  );

  it("allows the next serialized mutation after secure randomness recovers", async () => {
    const { store } = makeStore();
    vi.stubGlobal("crypto", {});
    await expect(
      store.setKillSwitch("signup", "closed", { actor: "test-operator" }),
    ).rejects.toBeInstanceOf(CryptoIdError);

    vi.stubGlobal("crypto", { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
    await store.setKillSwitch("signup", "closed", { actor: "test-operator" });

    expect(store.getKillSwitch("signup")?.version).toBe(1);
    expect(store.getAudit()).toHaveLength(1);
    expect(store.getAudit()[0].id).toMatch(/^bca_[0-9a-f]{32}$/);
  });
});
