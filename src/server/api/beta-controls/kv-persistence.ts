import type {
  BetaControlPersistence,
  BetaControlSnapshotData,
  VersionedBetaControlPersistence,
} from "./store";
import { BetaControlPersistenceConflictError, MemoryPersistence } from "./store";

/**
 * Shared persistence for operator beta controls.
 *
 * BETA-095: every worker falls back to `MemoryPersistence` unless the factory
 * is given a shared adapter, so operator kill-switch / flag / cohort / invite
 * mutations were invisible across workers and lost on restart. This adapter
 * writes the authoritative snapshot to the deployment's KV namespace so changes
 * are durable and propagate to every worker after the bounded cache TTL.
 * The production factory prefers the coordinator Durable Object because KV
 * does not expose a compare-and-set operation.
 *
 * When no KV binding is available (local dev, tests, single-process runs) it
 * degrades to the in-memory adapter so the service remains usable.
 */

const SNAPSHOT_KEY = "beta-controls:snapshot";

interface KvLike {
  get(key: string, type?: "text" | "json"): Promise<unknown>;
  put(key: string, value: string, opts?: unknown): Promise<void>;
}

interface CoordinatorNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): {
    getBetaControlSnapshot(): Promise<{
      snapshot: BetaControlSnapshotData | null;
      version: number;
    }>;
    saveBetaControlSnapshot(
      snapshot: BetaControlSnapshotData,
      expectedVersion: number,
    ): Promise<{ ok: true; version: number } | { ok: false; currentVersion: number }>;
  };
}

function isKvLike(value: unknown): value is KvLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as KvLike).get === "function" &&
    typeof (value as KvLike).put === "function"
  );
}

function isCoordinatorNamespaceLike(value: unknown): value is CoordinatorNamespaceLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as CoordinatorNamespaceLike).idFromName === "function" &&
    typeof (value as CoordinatorNamespaceLike).get === "function"
  );
}

/**
 * Selects the appropriate persistence adapter for the current deployment. A
 * KV binding is used when present; otherwise the in-memory adapter is used.
 */
export function createBetaControlPersistence(
  kvBinding: unknown,
  coordinatorBinding?: unknown,
): BetaControlPersistence {
  if (isCoordinatorNamespaceLike(coordinatorBinding)) {
    return new DurableObjectBetaControlPersistence(
      coordinatorBinding,
      isKvLike(kvBinding) ? kvBinding : undefined,
    );
  }
  if (isKvLike(kvBinding)) {
    return new KvBetaControlPersistence(kvBinding);
  }
  return new MemoryPersistence();
}

const kvWriteLocks = new WeakMap<object, Promise<unknown>>();

type StoredSnapshot = {
  snapshot: BetaControlSnapshotData;
  version: number;
};

function decodeStoredSnapshot(raw: unknown): {
  snapshot: BetaControlSnapshotData | null;
  version: number;
} {
  if (!raw || typeof raw !== "object") return { snapshot: null, version: 0 };
  const candidate = raw as { snapshot?: unknown; version?: unknown };
  if (
    typeof candidate.snapshot === "object" &&
    candidate.snapshot !== null &&
    typeof candidate.version === "number"
  ) {
    return candidate as StoredSnapshot;
  }
  return { snapshot: raw as BetaControlSnapshotData, version: 0 };
}

function runKvExclusive<T>(kv: KvLike, fn: () => Promise<T>): Promise<T> {
  const previous = kvWriteLocks.get(kv as object) ?? Promise.resolve();
  const result = previous.then(fn, fn);
  kvWriteLocks.set(
    kv as object,
    result.catch(() => undefined),
  );
  return result;
}

class KvBetaControlPersistence implements VersionedBetaControlPersistence {
  private kv: KvLike;

  constructor(kv: KvLike) {
    this.kv = kv;
  }

  async loadVersioned(): Promise<{
    snapshot: BetaControlSnapshotData | null;
    version: number;
  }> {
    const raw = await this.kv.get(SNAPSHOT_KEY, "json");
    return decodeStoredSnapshot(raw);
  }

  async saveVersioned(snapshot: BetaControlSnapshotData, expectedVersion: number): Promise<number> {
    return runKvExclusive(this.kv, async () => {
      const current = await this.loadVersioned();
      if (current.version !== expectedVersion) {
        throw new BetaControlPersistenceConflictError(current.version);
      }
      const version = current.version + 1;
      await this.kv.put(
        SNAPSHOT_KEY,
        JSON.stringify({ snapshot, version } satisfies StoredSnapshot),
      );
      return version;
    });
  }

  async load(): Promise<BetaControlSnapshotData | null> {
    return (await this.loadVersioned()).snapshot;
  }

  async save(snapshot: BetaControlSnapshotData): Promise<void> {
    await this.saveVersioned(snapshot, (await this.loadVersioned()).version);
  }
}

class DurableObjectBetaControlPersistence implements VersionedBetaControlPersistence {
  private readonly stub: ReturnType<CoordinatorNamespaceLike["get"]>;
  private readonly legacyKv?: KvLike;

  constructor(namespace: CoordinatorNamespaceLike, legacyKv?: KvLike) {
    this.stub = namespace.get(namespace.idFromName("beta-controls"));
    this.legacyKv = legacyKv;
  }

  async loadVersioned(): Promise<{
    snapshot: BetaControlSnapshotData | null;
    version: number;
  }> {
    const current = await this.stub.getBetaControlSnapshot();
    if (current.snapshot || !this.legacyKv) return current;

    const legacy = decodeStoredSnapshot(await this.legacyKv.get(SNAPSHOT_KEY, "json"));
    if (!legacy.snapshot) return current;

    const imported = await this.stub.saveBetaControlSnapshot(legacy.snapshot, current.version);
    if (imported.ok) return { snapshot: legacy.snapshot, version: imported.version };
    return this.stub.getBetaControlSnapshot();
  }

  async saveVersioned(snapshot: BetaControlSnapshotData, expectedVersion: number): Promise<number> {
    const result = await this.stub.saveBetaControlSnapshot(snapshot, expectedVersion);
    if (!result.ok) throw new BetaControlPersistenceConflictError(result.currentVersion);
    return result.version;
  }

  async load(): Promise<BetaControlSnapshotData | null> {
    return (await this.loadVersioned()).snapshot;
  }

  async save(snapshot: BetaControlSnapshotData): Promise<void> {
    await this.saveVersioned(snapshot, (await this.loadVersioned()).version);
  }
}
