// src/features/demo-admin-dashboard/persistence/localStorageAdapter.ts

export type PersistenceError =
  | { kind: "quota_exceeded" }
  | { kind: "parse_error" }
  | { kind: "storage_error"; cause: unknown };

export type SaveResult = { ok: true } | { ok: false; error: PersistenceError };
export type LoadResult<T> =
  | { ok: true; value: T | null; missing: boolean }
  | { ok: false; error: PersistenceError };

function toPersistenceError(err: unknown): PersistenceError {
  if (err instanceof DOMException && (err.name === "QuotaExceededError" || (err as any).code === 22)) {
    return { kind: "quota_exceeded" };
  }
  if (err instanceof SyntaxError) return { kind: "parse_error" };
  return { kind: "storage_error", cause: err };
}

export interface StorageAdapter<T> {
  /** Save a value under a given key */
  save(key: string, value: T): SaveResult;
  /** Load a value by key; the result distinguishes missing keys, parse errors, and storage errors */
  /** Load a value by key; corrupt data is distinct from a missing key. */
  load(key: string): LoadResult<T>;
  /** Remove a value from storage */
  clear(key: string): SaveResult;
}

export type StorageError =
  | { kind: "quota_exceeded" }
  | { kind: "parse_error" }
  | { kind: "storage_error" };

export type SaveResult = { ok: true } | { ok: false; error: StorageError };

export type LoadResult<T> =
  | { ok: true; value: T | null; missing: boolean }
  | { ok: false; error: StorageError };

function classifyStorageError(error: unknown, operation: "save" | "load" | "clear"): StorageError {
  if (
    operation === "save" &&
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.code === 22 || error.code === 1014)
  ) {
    return { kind: "quota_exceeded" };
  }
  if (operation === "load" && error instanceof SyntaxError) {
    return { kind: "parse_error" };
  }
  return { kind: "storage_error" };
}

export type LocalStorageOperation = "save" | "load" | "clear";

/** A storage failure that callers can surface instead of silently losing state. */
export class LocalStoragePersistenceError extends Error {
  readonly operation: LocalStorageOperation;
  readonly key: string;

  constructor(operation: LocalStorageOperation, key: string, cause: unknown) {
    super(`Unable to ${operation} localStorage key "${key}"`, { cause });
    this.name = "LocalStoragePersistenceError";
    this.operation = operation;
    this.key = key;
  }
}

/**
 * Simple wrapper around the browser's `localStorage` that serialises values as JSON.
 * It is generic so it can be reused for any type (e.g., the Draft state).
 */
export class LocalStorageAdapter<T> implements StorageAdapter<T> {
  save(key: string, value: T): SaveResult {
    try {
      (globalThis as any).localStorage.setItem(key, JSON.stringify(value));
      return { ok: true };
    } catch (e) {
      throw new LocalStoragePersistenceError("save", key, e);
      console.error("LocalStorageAdapter.save error", e);
      return { ok: false, error: toPersistenceError(e) };
  constructor(private readonly providedStorage?: Storage) {}

  private get storage(): Storage {
    return (
      this.providedStorage ??
      (globalThis as typeof globalThis & { localStorage: Storage }).localStorage
    );
  }

  save(key: string, value: T): SaveResult {
    try {
      const serialized = JSON.stringify(value);
      this.storage.setItem(key, serialized);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: classifyStorageError(error, "save") };
    }
  }

  load(key: string): LoadResult<T> {
    let raw: string | null;
    try {
      raw = (globalThis as any).localStorage.getItem(key) as string | null;
    } catch (e) {
      throw new LocalStoragePersistenceError("load", key, e);
      console.error("LocalStorageAdapter.load error", e);
      return { ok: false, error: toPersistenceError(e) };
    }
    if (raw === null) return { ok: true, value: null, missing: true };
    try {
      return { ok: true, value: JSON.parse(raw) as T, missing: false };
    } catch (e) {
      console.error("LocalStorageAdapter.load parse error", e);
      return { ok: false, error: { kind: "parse_error" } };
    try {
      const raw = this.storage.getItem(key);
      if (raw === null) return { ok: true, value: null, missing: true };
      return { ok: true, value: JSON.parse(raw) as T, missing: false };
    } catch (error) {
      return { ok: false, error: classifyStorageError(error, "load") };
    }
  }

  clear(key: string): SaveResult {
    try {
      (globalThis as any).localStorage.removeItem(key);
    } catch (e) {
      throw new LocalStoragePersistenceError("clear", key, e);
      this.storage.removeItem(key);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: classifyStorageError(error, "clear") };
    }
  }
}

function unwrapLoad<T>(result: LoadResult<T>): T | null {
  return result.ok ? result.value : null;
}

// Convenience helpers for Draft state persistence
import { Draft } from "../types/draft";
import { CampaignTag } from "../types/campaignTag";
import { defaultCampaignTags } from "../fixtures/campaignTagFixtures";
import { CampaignSnapshot } from "../types/campaignSnapshot";
import { defaultCampaignSnapshots } from "../fixtures/campaignSnapshotFixtures";

const draftAdapter = new LocalStorageAdapter<Draft>();
const DRAFT_KEY = "demoAdminDraft";

export function saveDraft(draft: Draft): void {
  draftAdapter.save(DRAFT_KEY, draft);
}

export function loadDraft(): Draft | null {
  const r = draftAdapter.load(DRAFT_KEY);
  return r.ok ? r.value : null;
  return unwrapLoad(draftAdapter.load(DRAFT_KEY));
}

export function clearDraft(): void {
  draftAdapter.clear(DRAFT_KEY);
}

// Active draft dataset persistence
const datasetAdapter = new LocalStorageAdapter<Draft[]>();
const DATASET_KEY = "demoAdminDraftDataset";

export function saveDraftDataset(dataset: Draft[]): void {
  datasetAdapter.save(DATASET_KEY, dataset);
}

export function loadDraftDataset(): Draft[] | null {
  const r = datasetAdapter.load(DATASET_KEY);
  return r.ok ? r.value : null;
  return unwrapLoad(datasetAdapter.load(DATASET_KEY));
}

export function clearDraftDataset(): void {
  datasetAdapter.clear(DATASET_KEY);
}

// Campaign snapshots persistence
const snapshotAdapter = new LocalStorageAdapter<CampaignSnapshot[]>();
const SNAPSHOTS_KEY = "demoAdminCampaignSnapshots";

export function saveCampaignSnapshots(snapshots: CampaignSnapshot[]): void {
  snapshotAdapter.save(SNAPSHOTS_KEY, snapshots);
}

export function loadCampaignSnapshots(): CampaignSnapshot[] {
  const r = snapshotAdapter.load(SNAPSHOTS_KEY);
  if (!r.ok || r.value === null) {
  const loaded = unwrapLoad(snapshotAdapter.load(SNAPSHOTS_KEY));
  if (loaded === null) {
    return defaultCampaignSnapshots;
  }
  return r.value;
}

export function clearCampaignSnapshots(): void {
  snapshotAdapter.clear(SNAPSHOTS_KEY);
}

// Campaign tags persistence
const tagAdapter = new LocalStorageAdapter<CampaignTag[]>();
const TAGS_KEY = "demoAdminCampaignTags";

export function saveCampaignTags(tags: CampaignTag[]): void {
  tagAdapter.save(TAGS_KEY, tags);
}

export function loadCampaignTags(): CampaignTag[] {
  const r = tagAdapter.load(TAGS_KEY);
  if (!r.ok || r.value === null) {
  const loaded = unwrapLoad(tagAdapter.load(TAGS_KEY));
  if (loaded === null) {
    return defaultCampaignTags;
  }
  return r.value;
}

export function clearCampaignTags(): void {
  tagAdapter.clear(TAGS_KEY);
}

// Segment editor state persistence
import { SegmentEditorState } from "../types/segmentEditorState";

const segmentEditorAdapter = new LocalStorageAdapter<SegmentEditorState>();
const SEGMENT_EDITOR_KEY = "stealth-demo-segment-editor";

export function saveSegmentEditorState(state: SegmentEditorState): void {
  segmentEditorAdapter.save(SEGMENT_EDITOR_KEY, state);
}

export function loadSegmentEditorState(): SegmentEditorState | null {
  const r = segmentEditorAdapter.load(SEGMENT_EDITOR_KEY);
  return r.ok ? r.value : null;
  return unwrapLoad(segmentEditorAdapter.load(SEGMENT_EDITOR_KEY));
}

export function clearSegmentEditorState(): void {
  segmentEditorAdapter.clear(SEGMENT_EDITOR_KEY);
}

// Campaign message assignment persistence
import { AssignmentState } from "../types/assignment";

const assignmentsAdapter = new LocalStorageAdapter<AssignmentState>();
const ASSIGNMENTS_KEY = "stealth-demo-assignments";

export function saveAssignments(state: AssignmentState): void {
  assignmentsAdapter.save(ASSIGNMENTS_KEY, state);
}

export function loadAssignments(): AssignmentState | null {
  const r = assignmentsAdapter.load(ASSIGNMENTS_KEY);
  return r.ok ? r.value : null;
  return unwrapLoad(assignmentsAdapter.load(ASSIGNMENTS_KEY));
}

export function clearAssignments(): void {
  assignmentsAdapter.clear(ASSIGNMENTS_KEY);
}

