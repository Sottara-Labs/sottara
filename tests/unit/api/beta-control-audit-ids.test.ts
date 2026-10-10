import { afterEach, describe, expect, it, vi } from "vitest";
import { BetaControlStore } from "../../../src/server/api/beta-controls/store";

const originalCrypto = globalThis.crypto;

afterEach(() => {
  vi.stubGlobal("crypto", originalCrypto);
});

describe("beta control audit identifiers", () => {
  it("uses the CSPRNG when randomUUID is unavailable", async () => {
    let counter = 0;
    vi.stubGlobal("crypto", {
      getRandomValues(bytes: Uint8Array) {
        bytes.fill(counter++);
        return bytes;
      },
    });

    const store = new BetaControlStore();
    await store.setKillSwitch("signup", "closed", { actor: "operator" });
    await store.setKillSwitch("signup", "open", { actor: "operator" });

    const audit = store.getAudit();
    expect(audit).toHaveLength(2);
    expect(audit[0].id).toMatch(/^bca_[0-9a-f]{32}$/);
    expect(audit[1].id).toMatch(/^bca_[0-9a-f]{32}$/);
    expect(audit[0].id).not.toBe(audit[1].id);
  });

  it("fails explicitly when no cryptographically secure source is available", async () => {
    vi.stubGlobal("crypto", {});

    const store = new BetaControlStore();
    await expect(store.setKillSwitch("signup", "closed", { actor: "operator" })).rejects.toThrow(
      "cryptographically secure random source is unavailable",
    );
  });
});
