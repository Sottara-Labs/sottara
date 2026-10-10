import { describe, expect, it } from "vitest";
import {
  DeviceKeyError,
  RecipientDeviceRegistry,
  generateDeviceKeyPair,
  hasActiveDevices,
  wrapContentKeyForActiveDevices,
} from "../../../src/services/crypto/device-keys";

describe("RecipientDeviceRegistry", () => {
  it("starts empty and reports no active devices", () => {
    const registry = new RecipientDeviceRegistry();

    expect(registry.activeDevices()).toEqual([]);
    expect(hasActiveDevices(registry)).toBe(false);
  });

  it("keeps revoked devices in history while excluding them from active devices", async () => {
    const registry = new RecipientDeviceRegistry();
    const first = await generateDeviceKeyPair();
    const second = await generateDeviceKeyPair();
    const addedAt = new Date("2026-01-01T00:00:00.000Z");
    const revokedAt = new Date("2026-01-02T00:00:00.000Z");

    const firstRecord = await registry.addDevice(first.publicKeySpkiBase64, addedAt);
    const secondRecord = await registry.addDevice(second.publicKeySpkiBase64, addedAt);
    registry.removeDevice(firstRecord.deviceId, revokedAt);

    expect(registry.getDevice(firstRecord.deviceId)).toMatchObject({
      deviceId: firstRecord.deviceId,
      revokedAt: revokedAt.toISOString(),
    });
    expect(registry.activeDevices()).toEqual([secondRecord]);
    expect(registry.isActive(firstRecord.deviceId)).toBe(false);
    expect(registry.isActive(secondRecord.deviceId)).toBe(true);
    expect(hasActiveDevices(registry)).toBe(true);

    registry.removeDevice(secondRecord.deviceId, revokedAt);
    expect(hasActiveDevices(registry)).toBe(false);
  });

  it("rejects duplicate public keys and unknown devices", async () => {
    const registry = new RecipientDeviceRegistry();
    const device = await generateDeviceKeyPair();
    const record = await registry.addDevice(device.publicKeySpkiBase64);

    await expect(registry.addDevice(device.publicKeySpkiBase64)).rejects.toMatchObject({
      name: "DeviceKeyError",
      code: "crypto_key_error",
    });
    expect(() => registry.removeDevice("missing-device")).toThrow(DeviceKeyError);
    expect(registry.getDevice(record.deviceId)).toBeDefined();
  });
});

describe("wrapContentKeyForActiveDevices", () => {
  it("fans out one wrapped entry per active device", async () => {
    const registry = new RecipientDeviceRegistry();
    const first = await generateDeviceKeyPair();
    const second = await generateDeviceKeyPair();
    const firstRecord = await registry.addDevice(first.publicKeySpkiBase64);
    const secondRecord = await registry.addDevice(second.publicKeySpkiBase64);
    registry.removeDevice(firstRecord.deviceId);
    const contentKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
      "encrypt",
      "decrypt",
    ]);

    const wrapped = await wrapContentKeyForActiveDevices(contentKey, registry);

    expect(wrapped).toHaveLength(1);
    expect(wrapped[0].deviceId).toBe(secondRecord.deviceId);
    expect(wrapped[0].entry.blindedRecipientId).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects malformed device keys without returning partial output", async () => {
    const registry = new RecipientDeviceRegistry();
    await registry.addDevice("AAAA");
    const contentKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
      "encrypt",
      "decrypt",
    ]);

    await expect(wrapContentKeyForActiveDevices(contentKey, registry)).rejects.toMatchObject({
      name: "DeviceKeyError",
      code: "crypto_key_error",
    });
  });
});
