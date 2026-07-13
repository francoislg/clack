import {
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  mkdir as fsMkdir,
} from "node:fs/promises";
import type { z } from "zod";

import { logger } from "../logger.js";
import { fileExists } from "../fs.js";
import {
  loadResilientCollection,
  serializeResilientCollection,
  writeResilientCollection,
  summarizeQuarantine,
  retryQuarantinedEntry,
  deleteQuarantinedEntry,
  isFrozen,
  clearFreeze,
  type QuarantineItem,
} from "./resilientCollection.js";
import { emitStateQuarantine, registerQuarantineStore } from "./stateQuarantineRegistry.js";

/**
 * Injected I/O so tests can stub without touching real disk. Defaults to `node:fs/promises` with
 * utf-8 reads.
 */
export interface ResilientStoreDeps {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, data: string) => Promise<void>;
  fileExists: (path: string) => Promise<boolean>;
  mkdir: (path: string, opts: { recursive: boolean }) => Promise<string | undefined>;
}

const defaultDeps: ResilientStoreDeps = {
  readFile: (path) => fsReadFile(path, "utf-8"),
  writeFile: fsWriteFile,
  fileExists,
  mkdir: fsMkdir,
};

interface CommonOptions<T> {
  /** Stable id carried in the Home Tab action value. */
  storeId: string;
  /** Human-readable source label for the panel + owner DM. */
  label: string;
  /** Resolved lazily so `process.cwd()` overrides in tests are honored. */
  getPath: () => string;
  entrySchema: z.ZodType<T>;
  deps?: ResilientStoreDeps;
}

export interface ArrayStoreHandle<T> {
  /** Valid entries, per-element parsed; quarantine is held internally. */
  load: () => Promise<T[]>;
  /** Persist a new valid collection, round-tripping the quarantine. False when frozen. */
  save: (items: T[]) => Promise<boolean>;
  clearCache: () => void;
  isFrozen: () => boolean;
}

export interface RecordStoreHandle<T> {
  load: () => Promise<Record<string, T>>;
  save: (entries: Record<string, T>) => Promise<boolean>;
  clearCache: () => void;
  isFrozen: () => boolean;
}

function logPersistFailure(err: unknown): void {
  logger.error("resilient-store: failed to persist quarantine on load:", err);
}

/**
 * Build a resilient ARRAY-collection store: per-element load + quarantine + freeze, quarantine
 * round-trip on save, owner DM on quarantine/freeze, and a Home Tab registry descriptor — all from
 * the shared core. The caller keeps its own public API and delegates load/save here.
 */
export function createArrayStore<T>(
  opts: CommonOptions<T> & { collectionKey: string; legacyQuarantineKey?: string },
): ArrayStoreHandle<T> {
  const deps = opts.deps ?? defaultDeps;
  let cache: { valid: T[]; quarantine: QuarantineItem[] } | null = null;

  async function persist(valid: T[], quarantine: QuarantineItem[]): Promise<boolean> {
    const serialized = serializeResilientCollection(valid, quarantine, {
      kind: "array",
      collectionKey: opts.collectionKey,
    });
    return writeResilientCollection(opts.getPath(), serialized, {
      writeFile: deps.writeFile,
      fileExists: deps.fileExists,
      mkdir: deps.mkdir,
    });
  }

  async function ensureLoaded(): Promise<{ valid: T[]; quarantine: QuarantineItem[] }> {
    if (cache) return cache;
    const result = await loadResilientCollection<T>({
      path: opts.getPath(),
      source: opts.label,
      kind: "array",
      collectionKey: opts.collectionKey,
      legacyQuarantineKey: opts.legacyQuarantineKey,
      entrySchema: opts.entrySchema,
      readFile: deps.readFile,
      fileExists: deps.fileExists,
      onQuarantine: emitStateQuarantine,
    });
    const valid = Array.isArray(result.valid) ? result.valid : [];
    cache = { valid, quarantine: result.quarantine };
    // Persist a fresh quarantine move so later loads carry it silently (no repeat owner DM).
    if (result.quarantine.length > 0 && !result.frozen) {
      await persist(valid, result.quarantine).catch(logPersistFailure);
    }
    return cache;
  }

  registerQuarantineStore({
    storeId: opts.storeId,
    label: opts.label,
    getSummaries: async () =>
      summarizeQuarantine((await ensureLoaded()).quarantine, opts.entrySchema),
    retry: async (key) => {
      const state = await ensureLoaded();
      const outcome = retryQuarantinedEntry(state.quarantine, key, opts.entrySchema);
      if (!outcome.ok || outcome.entry === undefined || outcome.remaining === undefined) {
        return { ok: false, error: outcome.error };
      }
      cache = { valid: [...state.valid, outcome.entry], quarantine: outcome.remaining };
      await persist(cache.valid, cache.quarantine);
      return { ok: true };
    },
    remove: async (key) => {
      const state = await ensureLoaded();
      const remaining = deleteQuarantinedEntry(state.quarantine, key);
      if (remaining === null) return false;
      cache = { valid: state.valid, quarantine: remaining };
      await persist(cache.valid, cache.quarantine);
      return true;
    },
    isFrozen: () => isFrozen(opts.getPath()),
  });

  return {
    load: async () => (await ensureLoaded()).valid,
    save: async (items) => {
      const state = await ensureLoaded();
      cache = { valid: items, quarantine: state.quarantine };
      return persist(items, state.quarantine);
    },
    clearCache: () => {
      cache = null;
      clearFreeze(opts.getPath());
    },
    isFrozen: () => isFrozen(opts.getPath()),
  };
}

/** Build a resilient RECORD-collection store (keyed map). Same contract as {@link createArrayStore}. */
export function createRecordStore<T>(opts: CommonOptions<T>): RecordStoreHandle<T> {
  const deps = opts.deps ?? defaultDeps;
  let cache: { valid: Record<string, T>; quarantine: QuarantineItem[] } | null = null;

  async function persist(valid: Record<string, T>, quarantine: QuarantineItem[]): Promise<boolean> {
    const serialized = serializeResilientCollection(valid, quarantine, { kind: "record" });
    return writeResilientCollection(opts.getPath(), serialized, {
      writeFile: deps.writeFile,
      fileExists: deps.fileExists,
      mkdir: deps.mkdir,
    });
  }

  async function ensureLoaded(): Promise<{
    valid: Record<string, T>;
    quarantine: QuarantineItem[];
  }> {
    if (cache) return cache;
    const result = await loadResilientCollection<T>({
      path: opts.getPath(),
      source: opts.label,
      kind: "record",
      entrySchema: opts.entrySchema,
      readFile: deps.readFile,
      fileExists: deps.fileExists,
      onQuarantine: emitStateQuarantine,
    });
    const valid = Array.isArray(result.valid) ? {} : result.valid;
    cache = { valid, quarantine: result.quarantine };
    if (result.quarantine.length > 0 && !result.frozen) {
      await persist(valid, result.quarantine).catch(logPersistFailure);
    }
    return cache;
  }

  registerQuarantineStore({
    storeId: opts.storeId,
    label: opts.label,
    getSummaries: async () =>
      summarizeQuarantine((await ensureLoaded()).quarantine, opts.entrySchema),
    retry: async (key) => {
      const state = await ensureLoaded();
      const outcome = retryQuarantinedEntry(state.quarantine, key, opts.entrySchema);
      if (!outcome.ok || outcome.entry === undefined || outcome.remaining === undefined) {
        return { ok: false, error: outcome.error };
      }
      cache = { valid: { ...state.valid, [key]: outcome.entry }, quarantine: outcome.remaining };
      await persist(cache.valid, cache.quarantine);
      return { ok: true };
    },
    remove: async (key) => {
      const state = await ensureLoaded();
      const remaining = deleteQuarantinedEntry(state.quarantine, key);
      if (remaining === null) return false;
      cache = { valid: state.valid, quarantine: remaining };
      await persist(cache.valid, cache.quarantine);
      return true;
    },
    isFrozen: () => isFrozen(opts.getPath()),
  });

  return {
    load: async () => (await ensureLoaded()).valid,
    save: async (entries) => {
      const state = await ensureLoaded();
      cache = { valid: entries, quarantine: state.quarantine };
      return persist(entries, state.quarantine);
    },
    clearCache: () => {
      cache = null;
      clearFreeze(opts.getPath());
    },
    isFrozen: () => isFrozen(opts.getPath()),
  };
}
