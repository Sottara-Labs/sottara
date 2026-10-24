/**
 * Outbox persistence.
 *
 * Stores outbound messages and their delivery state in localStorage so an
 * in-flight send survives a page refresh. Only the encrypted envelope and
 * delivery metadata are persisted; plaintext is never written here.
 */
import { z } from "zod";
import type { EnvelopePayload } from "@/services/crypto/envelope";

export const OUTBOX_STATUSES = [
  "queued",
  "encrypting",
  "awaiting_signature",
  "reserving_postage",
  "submitting",
  "delivered",
  "failed",
] as const;

export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export interface OutboxStageSnapshot {
  id: string;
  label: string;
  status: "pending" | "active" | "done" | "error";
  detail?: string;
}

export interface OutboxEntry {
  id: string;
  createdAt: string;
  updatedAt: string;
  subject: string;
  recipients: string[];
  status: OutboxStatus;
  attempts: number;
  errorCode?: string;
  errorMessage?: string;
  envelope?: EnvelopePayload;
  ciphertext?: string;
  idempotencyKey?: string;
  supportId?: string;
  sender?: string;
  stages?: OutboxStageSnapshot[];
  canRetry?: boolean;
  isCommitted?: boolean;
  postageAmount?: string;
}

const OutboxStageSnapshotSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  status: z.enum(["pending", "active", "done", "error"]),
  detail: z.string().optional(),
});

export const OutboxEntrySchema = z
  .object({
    id: z.string().min(1),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1).optional(),
    subject: z.string().default(""),
    recipients: z.array(z.string()).default([]),
    status: z.enum(OUTBOX_STATUSES).default("queued"),
    attempts: z.number().int().nonnegative().default(0),
    errorCode: z.string().optional(),
    errorMessage: z.string().optional(),
    envelope: z.custom<EnvelopePayload>().optional(),
    ciphertext: z.string().optional(),
    idempotencyKey: z.string().optional(),
    supportId: z.string().optional(),
    sender: z.string().optional(),
    stages: z.array(OutboxStageSnapshotSchema).optional(),
    canRetry: z.boolean().optional(),
    isCommitted: z.boolean().optional(),
    postageAmount: z.string().optional(),
  })
  .transform(
    (entry): OutboxEntry => ({
      ...entry,
      updatedAt: entry.updatedAt ?? entry.createdAt,
    }),
  );

const STORAGE_KEY = "stealth.outbox.v1";

function isBrowser(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

function readRawList(): unknown[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readAll(): OutboxEntry[] {
  const rawItems = readRawList();
  const validEntries: OutboxEntry[] = [];
  for (const item of rawItems) {
    const parsed = OutboxEntrySchema.safeParse(item);
    if (parsed.success) {
      validEntries.push(parsed.data);
    }
  }
  return validEntries;
}

function writeAll(entries: OutboxEntry[], preservedInvalid: unknown[] = []): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([...entries, ...preservedInvalid]),
    );
  } catch {
    // Ignore quota / serialization failures; persistence is best-effort.
  }
}

function splitStoredEntries(): { valid: OutboxEntry[]; invalid: unknown[] } {
  const valid: OutboxEntry[] = [];
  const invalid: unknown[] = [];
  for (const item of readRawList()) {
    const parsed = OutboxEntrySchema.safeParse(item);
    if (parsed.success) {
      valid.push(parsed.data);
    } else {
      invalid.push(item);
    }
  }
  return { valid, invalid };
}

export function listOutbox(): OutboxEntry[] {
  return readAll().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getEntry(id: string): OutboxEntry | undefined {
  return readAll().find((entry) => entry.id === id);
}

export function upsertEntry(entry: OutboxEntry): OutboxEntry {
  const { valid: entries, invalid } = splitStoredEntries();
  const next = OutboxEntrySchema.parse({
    ...entry,
    updatedAt: new Date().toISOString(),
  });
  const index = entries.findIndex((item) => item.id === entry.id);
  if (index >= 0) {
    entries[index] = next;
  } else {
    entries.push(next);
  }
  writeAll(entries, invalid);
  return next;
}

export function patchEntry(
  id: string,
  patch: Partial<Omit<OutboxEntry, "id">>,
): OutboxEntry | undefined {
  const { valid: entries, invalid } = splitStoredEntries();
  const index = entries.findIndex((item) => item.id === id);
  if (index < 0) return undefined;
  const next = OutboxEntrySchema.parse({
    ...entries[index],
    ...patch,
    updatedAt: new Date().toISOString(),
  });
  entries[index] = next;
  writeAll(entries, invalid);
  return next;
}

export function removeEntry(id: string): void {
  const { valid: entries, invalid } = splitStoredEntries();
  writeAll(
    entries.filter((entry) => entry.id !== id),
    invalid,
  );
}

export function createEntry(input: {
  id: string;
  subject: string;
  recipients: string[];
  sender?: string;
  idempotencyKey?: string;
  supportId?: string;
  stages?: OutboxStageSnapshot[];
}): OutboxEntry {
  const now = new Date().toISOString();
  return upsertEntry({
    id: input.id,
    createdAt: now,
    updatedAt: now,
    subject: input.subject,
    recipients: input.recipients,
    sender: input.sender,
    idempotencyKey: input.idempotencyKey,
    supportId: input.supportId,
    stages: input.stages,
    status: "queued",
    attempts: 0,
  });
}

export function getIncompleteEntries(): OutboxEntry[] {
  return readAll().filter((entry) => entry.status !== "delivered");
}
