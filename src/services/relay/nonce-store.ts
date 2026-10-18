export interface NonceStore {
  /**
   * Record a nonce as used. Returns `true` when the nonce was newly consumed and
   * `false` when it had already been seen (a replay).
   */
  consume(nonce: string, expiresAt?: number): Promise<boolean>;
}

/**
 * Isolate-local nonce store. Suitable for tests and single-isolate development only.
 * Production must supply a shared implementation (see `shared-nonce-store.ts`).
 */
export class InMemoryNonceStore implements NonceStore {
  private readonly seen = new Map<string, number | undefined>();

  async consume(nonce: string, expiresAt?: number): Promise<boolean> {
    const now = Date.now();

    for (const [key, expiration] of this.seen.entries()) {
      if (expiration !== undefined && expiration <= now) {
        this.seen.delete(key);
      }
    }

    if (this.seen.has(nonce)) {
      return false;
    }

    this.seen.set(nonce, expiresAt);
    return true;
  }
}
