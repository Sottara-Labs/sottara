import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function makeStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}

describe("mailbox device ids", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", makeStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("generates distinct CSPRNG ids and preserves the checkpoint key shape", async () => {
    const { getDeviceId, syncCheckpointStorageKey } = await import("@/features/mail/live-mailbox");
    const first = getDeviceId();

    vi.resetModules();
    localStorage.removeItem("stealth.device_id");
    const { getDeviceId: getSecondDeviceId } = await import("@/features/mail/live-mailbox");
    const second = getSecondDeviceId();

    expect(first).toMatch(/^dev_[0-9a-f-]{32,}$/);
    expect(second).toMatch(/^dev_[0-9a-f-]{32,}$/);
    expect(second).not.toBe(first);
    expect(syncCheckpointStorageKey("actor", first)).toBe(
      `stealth.mailbox.checkpoint.actor.${first}`,
    );
  });

  it("returns an existing stored id unchanged", async () => {
    localStorage.setItem("stealth.device_id", "dev_legacy_device");
    const { getDeviceId } = await import("@/features/mail/live-mailbox");

    expect(getDeviceId()).toBe("dev_legacy_device");
  });

  it("uses getRandomValues when randomUUID is unavailable", async () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0xab);
        return bytes;
      },
    });
    const { getDeviceId } = await import("@/features/mail/live-mailbox");

    expect(getDeviceId()).toBe(`dev_${"ab".repeat(16)}`);
  });

  it("fails loudly when no CSPRNG is available", async () => {
    vi.stubGlobal("crypto", {});
    const { getDeviceId } = await import("@/features/mail/live-mailbox");

    expect(() => getDeviceId()).toThrow(/CSPRNG/);
  });
});
