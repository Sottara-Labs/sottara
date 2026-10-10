import { describe, expect, it } from "vitest";

import {
  archiveAad,
  backupKeyId,
  deriveBackupKey,
  openBackupPayload,
  sealBackupPayload,
} from "@/server/backup/encryption";
import type { BackupArchive, BackupArchiveHeader, BackupPayload } from "@/server/backup/types";

function randomBase64Key(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
}

function makeHeader(overrides: Partial<BackupArchiveHeader> = {}): BackupArchiveHeader {
  return {
    format: "stealth-backup",
    version: 1,
    createdAt: "2026-10-01T00:00:00.000Z",
    generatedBy: "unit-test",
    source: "local-emulation",
    encryption: {
      cipher: "AES-256-GCM",
      kdf: "HKDF-SHA256",
      kdfPurpose: "stealth-backup-v1",
      keyId: "test-key-id",
    },
    ...overrides,
  };
}

function makePayload(): BackupPayload {
  return {
    manifest: {
      version: 1,
      createdAt: "2026-10-01T00:00:00.000Z",
      stores: [{ store: "kv", count: 1, byteLength: 5 }],
      entries: [{ store: "kv", key: "fingerprint", digest: "deadbeef", byteLength: 5 }],
    },
    entries: [{ store: "kv", key: "some-key", encoding: "text", value: "hello" }],
  };
}

/** Matches the production call sites: flatten the sealed header into the archive. */
async function sealToArchive(key: CryptoKey, header: BackupArchiveHeader, payload: BackupPayload) {
  const sealed = await sealBackupPayload(key, header, payload);
  const archive: BackupArchive = { ...sealed.header, ...sealed };
  return archive;
}

describe("backup archive encryption", () => {
  it("round-trips seal -> open and deep-equals the payload", async () => {
    const key = await deriveBackupKey(randomBase64Key());
    const header = makeHeader();
    const payload = makePayload();

    const archive = await sealToArchive(key, header, payload);

    await expect(openBackupPayload(key, archive)).resolves.toEqual(payload);
  });

  it("rejects an archive whose header.createdAt was tampered with", async () => {
    const key = await deriveBackupKey(randomBase64Key());
    const payload = makePayload();

    const archive = await sealToArchive(key, makeHeader(), payload);
    const tampered: BackupArchive = { ...archive, createdAt: "2026-10-02T00:00:00.000Z" };

    await expect(openBackupPayload(key, tampered)).rejects.toThrow();
  });

  it("rejects opening with a different key", async () => {
    const key = await deriveBackupKey(randomBase64Key());
    const otherKey = await deriveBackupKey(randomBase64Key());
    const archive = await sealToArchive(key, makeHeader(), makePayload());

    await expect(openBackupPayload(otherKey, archive)).rejects.toThrow();
  });

  it("produces different AAD when the header differs", () => {
    const header = makeHeader();
    const changed = makeHeader({ createdAt: "2026-10-02T00:00:00.000Z" });

    const aad = Buffer.from(archiveAad(header)).toString("hex");
    const aadChanged = Buffer.from(archiveAad(changed)).toString("hex");
    const aadSame = Buffer.from(archiveAad(makeHeader())).toString("hex");

    expect(aadChanged).not.toBe(aad);
    expect(aadSame).toBe(aad);
  });

  it("derives stable, non-secret key ids", async () => {
    const secret = randomBase64Key();
    const first = await backupKeyId(secret);
    const second = await backupKeyId(secret);
    const other = await backupKeyId(randomBase64Key());

    expect(first).toBe(second);
    expect(first).toHaveLength(16);
    expect(other).not.toBe(first);
  });
});

