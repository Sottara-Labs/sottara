import { canonicalize } from "./jcs";
import { type SealedEnvelope } from "./envelope";
import { sealedEnvelopeSchema } from "./schema";

const FINGERPRINT_VERSION = "v1";

/**
 * Derives a versioned, cryptographic fingerprint of a sealed envelope.
 * The fingerprint is deterministic and binds all protected metadata fields
 * (sender, recipient, timestamp, commitment, attachments, etc.) along with
 * the ciphertext, completely excluding any plaintext.
 *
 * Format: `v1:fp:sha256:<64-hex-chars>`
 *
 * @param envelope The sealed envelope to fingerprint.
 * @returns A promise resolving to the versioned fingerprint string.
 */
export async function deriveEnvelopeFingerprint(envelope: SealedEnvelope): Promise<string> {
  // Validate the envelope structure using the schema to ensure we only
  // fingerprint valid structures.
  const validated = sealedEnvelopeSchema.parse(envelope);

  // Canonicalize the validated sealed envelope to produce a stable JSON string representation.
  const canonicalString = canonicalize(validated);

  // Compute SHA-256 hash of the canonical representation.
  const data = new TextEncoder().encode(canonicalString);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hexDigest = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  return `${FINGERPRINT_VERSION}:fp:sha256:${hexDigest}`;
}

/**
 * Store for tracking seen fingerprints.
 * Decouples storage details (e.g. Memory, Redis, PostgreSQL) from primitive crypto code.
 *
 * The store exposes a single atomic `claim` operation instead of separate
 * check-then-set calls: implementations must complete the test-and-set
 * without yielding between the check and the write, so two concurrent
 * callers cannot both observe "unseen" (issue #292).
 */
export interface ReplayStore {
  /**
   * Atomically records `fingerprint` and reports whether it was already
   * present. `true` means replay (someone else claimed it first); `false`
   * means this call claimed it.
   */
  claim(fingerprint: string): boolean | Promise<boolean>;
}

/** How long a claimed fingerprint is remembered by default (dedup window). */
export const DEFAULT_REPLAY_TTL_MS = 15 * 60_000;

/** Options for {@link InMemoryReplayStore}. */
export interface InMemoryReplayStoreOptions {
  /** Entries older than this are shed. Defaults to {@link DEFAULT_REPLAY_TTL_MS}. */
  ttlMs?: number;
  /** Injectable clock (ms since epoch) for tests. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * In-memory replay store with a TTL. `claim` performs the test-and-set
 * synchronously, so concurrent callers race on a single atomic step and
 * exactly one is accepted. Entries older than the TTL are shed on every
 * access, keeping the store bounded over the process lifetime.
 */
export class InMemoryReplayStore implements ReplayStore {
  private readonly seen = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: InMemoryReplayStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_REPLAY_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  claim(fingerprint: string): boolean {
    const nowMs = this.now();
    this.prune(nowMs);
    if (this.seen.has(fingerprint)) {
      return true;
    }
    this.seen.set(fingerprint, nowMs);
    return false;
  }

  /** Number of live (unexpired) entries. */
  get size(): number {
    this.prune(this.now());
    return this.seen.size;
  }

  private prune(nowMs: number): void {
    for (const [fingerprint, claimedAt] of this.seen) {
      if (nowMs - claimedAt >= this.ttlMs) {
        this.seen.delete(fingerprint);
      }
    }
  }
}

/**
 * Checks if a given envelope fingerprint is a replay (already processed).
 * If not a replay, claims it in the store.
 *
 * @param fingerprint The envelope fingerprint to check.
 * @param store The storage driver implementing ReplayStore.
 * @returns A promise resolving to true if replay detected (fingerprint seen), false otherwise.
 */
export async function checkReplay(fingerprint: string, store: ReplayStore): Promise<boolean> {
  // A single atomic claim: implementations must not yield between the check
  // and the write, or concurrent callers could both be accepted.
  return await store.claim(fingerprint);
}
