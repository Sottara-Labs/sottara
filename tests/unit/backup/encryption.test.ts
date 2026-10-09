import { describe, expect, it } from "vitest";

import {
  backupKeyId,
  deriveBackupKey,
  openBackupPayload,
  sealBackupPayload,
} from "@/server/backup/encryption";
import {
  BACKUP_ARCHIVE_VERSION,
  BACKUP_FORMAT,
  type BackupArchive,
  type BackupArchiveHeader,
  type BackupPayload,
} from "@/server/backup/types";

const TEST_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const WRONG_KEY = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";

async function header(): Promise<BackupArchiveHeader> {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_ARCHIVE_VERSION,
    createdAt: "2026-10-09T00:00:00.000Z",
    generatedBy: "unit-test",
    source: "local-emulation",
    encryption: {
      cipher: "AES-256-GCM",
      kdf: "HKDF-SHA256",
      kdfPurpose: "stealth-backup-v1",
      keyId: await backupKeyId(TEST_KEY),
    },
  };
}

function archiveFromSealed(sealed: Awaited<ReturnType<typeof sealBackupPayload>>): BackupArchive {
  return { ...sealed.header, ...sealed };
}

const PAYLOAD: BackupPayload = {
  manifest: {
    version: 1,
    createdAt: "2026-10-09T00:00:00.000Z",
    stores: [{ store: "kv", count: 1, byteLength: 5 }],
    entries: [{ store: "kv", key: "redacted", digest: "a".repeat(64), byteLength: 5 }],
  },
  entries: [{ store: "kv", key: "policy:p1", encoding: "text", value: "hello" }],
};

describe("backup archive encryption", () => {
  it("round-trips the complete payload", async () => {
    const key = await deriveBackupKey(TEST_KEY);
    const sealed = archiveFromSealed(await sealBackupPayload(key, await header(), PAYLOAD));

    await expect(openBackupPayload(key, sealed)).resolves.toEqual(PAYLOAD);
  });

  it("rejects a header createdAt mutation through AAD authentication", async () => {
    const key = await deriveBackupKey(TEST_KEY);
    const sealed = archiveFromSealed(await sealBackupPayload(key, await header(), PAYLOAD));
    const tampered = {
      ...sealed,
      createdAt: "2000-01-01T00:00:00.000Z",
    };

    await expect(openBackupPayload(key, tampered)).rejects.toThrow(/authentication|AEAD|tampered/i);
  });

  it("rejects opening with a different derived key", async () => {
    const key = await deriveBackupKey(TEST_KEY);
    const wrongKey = await deriveBackupKey(WRONG_KEY);
    const sealed = archiveFromSealed(await sealBackupPayload(key, await header(), PAYLOAD));

    await expect(openBackupPayload(wrongKey, sealed)).rejects.toThrow();
  });
});
