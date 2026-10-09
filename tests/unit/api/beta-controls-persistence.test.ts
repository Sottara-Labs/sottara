import { describe, expect, it } from "vitest";

import { createBetaControlPersistence } from "@/server/api/beta-controls/kv-persistence";
import { BetaControlStore, type BetaControlSnapshotData } from "@/server/api/beta-controls/store";

function emptySnapshot(): BetaControlSnapshotData {
  return { killSwitches: {}, flags: {}, cohorts: {}, invites: {}, audit: [] };
}

class FakeCoordinator {
  private stored: { snapshot: BetaControlSnapshotData; version: number } | undefined;

  async getBetaControlSnapshot() {
    return this.stored ?? { snapshot: null, version: 0 };
  }

  async saveBetaControlSnapshot(snapshot: BetaControlSnapshotData, expectedVersion: number) {
    const currentVersion = this.stored?.version ?? 0;
    if (currentVersion !== expectedVersion) {
      return { ok: false as const, currentVersion };
    }
    this.stored = { snapshot, version: currentVersion + 1 };
    return { ok: true as const, version: currentVersion + 1 };
  }
}

function fakeCoordinatorNamespace(coordinator: FakeCoordinator) {
  return {
    idFromName: (_name: string) => ({ toString: () => "beta-controls" }),
    get: (_id: unknown) => coordinator,
  };
}

describe("beta control shared persistence", () => {
  it("reports a stale cross-worker save instead of discarding the first mutation", async () => {
    const coordinator = new FakeCoordinator();
    const namespace = fakeCoordinatorNamespace(coordinator);
    const first = new BetaControlStore(createBetaControlPersistence(undefined, namespace));
    const second = new BetaControlStore(createBetaControlPersistence(undefined, namespace));

    await Promise.all([first.init(), second.init()]);
    await first.setKillSwitch("signup", "closed", { actor: "operator-a" });

    await expect(
      second.setKillSwitch("funding", "closed", { actor: "operator-b" }),
    ).rejects.toMatchObject({ status: 409 });

    const reloaded = new BetaControlStore(createBetaControlPersistence(undefined, namespace));
    await reloaded.init();
    expect(reloaded.getKillSwitch("signup")?.state).toBe("closed");
    expect(reloaded.getKillSwitch("funding")).toBeUndefined();
  });

  it("serializes concurrent saves and allows the losing worker to retry", async () => {
    const coordinator = new FakeCoordinator();
    const namespace = fakeCoordinatorNamespace(coordinator);
    const first = new BetaControlStore(createBetaControlPersistence(undefined, namespace));
    const second = new BetaControlStore(createBetaControlPersistence(undefined, namespace));

    await Promise.all([first.init(), second.init()]);
    const results = await Promise.allSettled([
      first.setKillSwitch("signup", "closed", { actor: "operator-a" }),
      second.setKillSwitch("funding", "closed", { actor: "operator-b" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    await second.setKillSwitch("funding", "closed", { actor: "operator-b" });
    const reloaded = new BetaControlStore(createBetaControlPersistence(undefined, namespace));
    await reloaded.init();
    expect(reloaded.getKillSwitch("signup")?.state).toBe("closed");
    expect(reloaded.getKillSwitch("funding")?.state).toBe("closed");
  });

  it("keeps the KV fallback versioned for local adapters", async () => {
    const values = new Map<string, unknown>();
    const kv = {
      async get(key: string) {
        return values.get(key) ?? null;
      },
      async put(key: string, value: string) {
        values.set(key, JSON.parse(value));
      },
    };
    const persistence = createBetaControlPersistence(kv);
    const store = new BetaControlStore(persistence);
    await store.init();
    await store.setKillSwitch("signup", "closed", { actor: "operator" });
    expect(values.get("beta-controls:snapshot")).toMatchObject({ version: 1 });
    expect((await persistence.load())?.killSwitches.signup.state).toBe("closed");
  });

  it("imports a legacy KV snapshot before switching to the coordinator", async () => {
    const coordinator = new FakeCoordinator();
    const namespace = fakeCoordinatorNamespace(coordinator);
    const legacy: BetaControlSnapshotData = {
      ...emptySnapshot(),
      killSwitches: {
        signup: {
          capability: "signup",
          state: "closed",
          updatedAt: "2026-01-01T00:00:00.000Z",
          updatedBy: "legacy",
          version: 1,
        },
      },
    };
    const kv = {
      async get() {
        return legacy;
      },
      async put() {
        throw new Error("legacy migration should write to the coordinator");
      },
    };

    const store = new BetaControlStore(createBetaControlPersistence(kv, namespace));
    await store.init();
    expect(store.getKillSwitch("signup")?.updatedBy).toBe("legacy");
    expect((await coordinator.getBetaControlSnapshot()).version).toBe(1);
  });
});
