import type { NonceStore } from "@/services/relay/nonce-store";

export class NonceService {
  constructor(private readonly store: NonceStore) {}

  /**
   * Consume a nonce. Returns `true` when the nonce is fresh and `false` when it has
   * already been seen -- i.e. the submission is a replay and must be rejected.
   */
  async consume(nonce: string, expiresAt?: number): Promise<boolean> {
    if (!nonce) {
      return false;
    }

    return this.store.consume(nonce, expiresAt);
  }
}
