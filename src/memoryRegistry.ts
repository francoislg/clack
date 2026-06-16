import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { logger } from "./logger.js";
import { fileExists } from "./fs.js";
import type { JsonObject, JsonValue } from "./config.js";
import { zodErrorToResult } from "./plugins/zodResult.js";

// ============================================================================
// Dependency Injection
// ============================================================================

export interface MemoryRegistryDeps {
  readFile: (path: string, encoding: "utf-8") => Promise<string>;
  writeFile: (path: string, data: string) => Promise<void>;
  mkdir: (path: string, options: { recursive: boolean }) => Promise<string | undefined>;
  fileExists: (path: string) => Promise<boolean>;
  now: () => Date;
}

export const defaultMemoryRegistryDeps: MemoryRegistryDeps = {
  readFile,
  writeFile,
  mkdir,
  fileExists,
  now: () => new Date(),
};

let deps: MemoryRegistryDeps = defaultMemoryRegistryDeps;

export function setMemoryRegistryDeps(d: MemoryRegistryDeps): void {
  deps = d;
}

export function resetMemoryRegistryDeps(): void {
  deps = defaultMemoryRegistryDeps;
}

// ============================================================================
// Types & Schema
// ============================================================================

/**
 * One reference recipe on a memory entry — a durable, self-describing surface (issue, PR,
 * thread) with how to read its status and how to comment back. Idempotency cursors do NOT
 * live here; they are execution state owned by the consuming plugin's namespace.
 */
export interface MemoryReference {
  kind: string;
  id: string;
  howToRead: string;
  howToComment: string;
}

/** Best-guess relevance horizon. `date` (ISO) is machine-enforceable; `reason` is advisory. */
export interface StaleAfter {
  date?: string;
  reason?: string;
}

/**
 * One record in `data/state/memory.json`. Core fields are durable knowledge a human would want
 * on recall; `plugins` is a per-plugin namespace bag — each plugin owns its slice under
 * `plugins.<pluginName>` and validates it with its own zod schema (core treats it as opaque).
 */
export interface MemoryEntry {
  id: string;
  what: string;
  why: string;
  staleAfter?: StaleAfter;
  nextSteps?: string;
  references: MemoryReference[];
  createdAt: string;
  updatedAt: string;
  plugins?: { [pluginName: string]: JsonObject };
}

/** Paginated search result. `total` is the full match count; `entries` is the requested page. */
export interface MemorySearchResult {
  total: number;
  limit: number;
  offset: number;
  entries: MemoryEntry[];
}

/** Input to remember a core entry. Timestamps and plugin namespaces are managed by the registry. */
export interface RememberInput {
  id: string;
  what?: string;
  why?: string;
  staleAfter?: StaleAfter;
  nextSteps?: string;
  references?: MemoryReference[];
}

const jsonValueZod: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueZod),
    z.record(z.string(), jsonValueZod),
  ]),
);

const jsonObjectZod = z.record(z.string(), jsonValueZod);

const referenceZod = z.object({
  kind: z.string().default(""),
  id: z.string().default(""),
  howToRead: z.string().default(""),
  howToComment: z.string().default(""),
});

const staleAfterZod = z.object({
  date: z.string().optional(),
  reason: z.string().optional(),
});

// Graceful (permissive) reader: a state file, so on a shape mismatch we log + treat the store
// as empty rather than throwing — and never narrow so hard that a real record is dropped. Fields
// tolerate missing values so a single legacy entry can't fail the whole map. `plugins` is opaque
// passthrough — core does not know plugin slice shapes; each plugin validates its own slice.
const memoryEntryZod = z.object({
  id: z.string(),
  what: z.string().default(""),
  why: z.string().default(""),
  staleAfter: staleAfterZod.optional(),
  nextSteps: z.string().optional(),
  references: z.array(referenceZod).default([]),
  createdAt: z.string().default(""),
  updatedAt: z.string().default(""),
  plugins: z.record(z.string(), jsonObjectZod).optional(),
});

const memoryStoreZod = z.record(z.string(), memoryEntryZod);

interface MemoryStore {
  [id: string]: MemoryEntry;
}

// ============================================================================
// Pre-expire hook registry
// ============================================================================

/** A plugin's veto on expiring one of its slice-bearing entries. Throw is treated as a veto. */
export interface BeforeExpireResult {
  vetoed: boolean;
  /** ISO date to push `staleAfter.date` out to, applied atomically with a retain. */
  extendUntil?: string;
}

export type BeforeExpireHook = (
  entry: MemoryEntry,
) => BeforeExpireResult | Promise<BeforeExpireResult>;

const beforeExpireHooks: Array<{ plugin: string; fn: BeforeExpireHook }> = [];

/** Register a plugin's pre-expire hook (consulted only for entries carrying that plugin's slice). */
export function registerBeforeExpire(plugin: string, fn: BeforeExpireHook): void {
  beforeExpireHooks.push({ plugin, fn });
}

export function clearBeforeExpireHooks(): void {
  beforeExpireHooks.length = 0;
}

// ============================================================================
// Load / persist
// ============================================================================

let cached: MemoryStore | null = null;

// All mutations funnel through this promise chain so concurrent read-modify-write from core
// (remember/recall tools) and plugins (namespace merges) can't lose updates.
let writeChain: Promise<void> = Promise.resolve();

function getStateDir(): string {
  return resolve(process.cwd(), "data", "state");
}

function getStorePath(): string {
  return resolve(getStateDir(), "memory.json");
}

export async function loadMemoryStore(): Promise<MemoryStore> {
  if (cached) {
    return cached;
  }

  const path = getStorePath();

  if (!(await deps.fileExists(path))) {
    cached = {};
    return cached;
  }

  try {
    const content = await deps.readFile(path, "utf-8");
    const result = memoryStoreZod.safeParse(JSON.parse(content));
    if (!result.success) {
      logger.warn(
        `memory.json has unexpected shape; using empty: ${zodErrorToResult(result.error, "memory").error}`,
      );
      cached = {};
      return cached;
    }
    cached = result.data;
    return cached;
  } catch (error) {
    logger.error("Failed to load memory store:", error);
    cached = {};
    return cached;
  }
}

async function persist(store: MemoryStore): Promise<void> {
  const stateDir = getStateDir();
  if (!(await deps.fileExists(stateDir))) {
    await deps.mkdir(stateDir, { recursive: true });
  }
  await deps.writeFile(getStorePath(), JSON.stringify(store, null, 2));
  cached = store;
}

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function nowIso(): string {
  return deps.now().toISOString();
}

// ============================================================================
// Reads
// ============================================================================

export async function getMemory(id: string): Promise<MemoryEntry | null> {
  const store = await loadMemoryStore();
  return store[id] ?? null;
}

export async function listMemory(): Promise<MemoryEntry[]> {
  const store = await loadMemoryStore();
  return Object.values(store);
}

export async function getMemoryNamespace(plugin: string, id: string): Promise<JsonObject | null> {
  const store = await loadMemoryStore();
  return store[id]?.plugins?.[plugin] ?? null;
}

export interface SearchMemoryArgs {
  query?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

const DEFAULT_SEARCH_LIMIT = 20;

function entryHaystack(entry: MemoryEntry): string {
  const refText = entry.references.map((r) => `${r.howToRead} ${r.howToComment}`).join(" ");
  return `${entry.id} ${entry.what} ${entry.why} ${entry.nextSteps ?? ""} ${refText}`.toLowerCase();
}

/**
 * Keyword + date-range, paginated search. `query` is a case-insensitive substring over core text
 * (`id`/`what`/`why`/`nextSteps` + each reference's recipes); `from`/`to` filter on `updatedAt`.
 * Returns whole entries (incl. `plugins`), newest-`updatedAt` first.
 */
export async function searchMemory(args: SearchMemoryArgs): Promise<MemorySearchResult> {
  const store = await loadMemoryStore();
  const limit = args.limit ?? DEFAULT_SEARCH_LIMIT;
  const offset = args.offset ?? 0;
  const needle = args.query?.trim().toLowerCase();

  let matches = Object.values(store);
  if (needle) {
    matches = matches.filter((e) => entryHaystack(e).includes(needle));
  }
  if (args.from) {
    matches = matches.filter((e) => e.updatedAt >= args.from!);
  }
  if (args.to) {
    matches = matches.filter((e) => e.updatedAt <= args.to!);
  }
  matches.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));

  const total = matches.length;
  const start = Math.max(0, offset);
  const entries = matches.slice(start, start + Math.max(0, limit));
  return { total, limit, offset, entries };
}

// ============================================================================
// Writes (serialized)
// ============================================================================

/**
 * Create or update a core memory entry by `id`. Preserves any existing `plugins` namespaces and
 * `createdAt`; only touches the core knowledge fields and bumps `updatedAt`. Omitted fields keep
 * their prior value (or sensible defaults on first create).
 */
export function rememberCore(input: RememberInput): Promise<MemoryEntry> {
  return serialize(async () => {
    const store = await loadMemoryStore();
    const existing = store[input.id];
    const ts = nowIso();
    const entry: MemoryEntry = {
      id: input.id,
      what: input.what ?? existing?.what ?? "",
      why: input.why ?? existing?.why ?? "",
      staleAfter: input.staleAfter ?? existing?.staleAfter,
      nextSteps: input.nextSteps ?? existing?.nextSteps,
      references: input.references ?? existing?.references ?? [],
      createdAt: existing?.createdAt || ts,
      updatedAt: ts,
      ...(existing?.plugins ? { plugins: existing.plugins } : {}),
    };
    const next: MemoryStore = { ...store, [input.id]: entry };
    await persist(next);
    return entry;
  });
}

/** Thrown when a plugin namespace merge targets an id with no core memory entry (core-first). */
export class MemoryEntryNotFoundError extends Error {
  constructor(id: string) {
    super(`No memory entry for id "${id}" — remember the core entry before merging a namespace`);
    this.name = "MemoryEntryNotFoundError";
  }
}

/**
 * Field-merge `partial` into `plugins.<plugin>` for `id` (omitted fields keep their prior value).
 * Rejects when the entry does not exist — memory is core-first; a plugin slice with no knowledge
 * record is meaningless and no placeholder is created. Serialized; bumps `updatedAt`.
 */
export function mergeMemoryNamespace(
  plugin: string,
  id: string,
  partial: JsonObject,
): Promise<void> {
  return serialize(async () => {
    const store = await loadMemoryStore();
    const base = store[id];
    if (!base) {
      throw new MemoryEntryNotFoundError(id);
    }
    const prevNamespace = base.plugins?.[plugin] ?? {};
    const entry: MemoryEntry = {
      ...base,
      updatedAt: nowIso(),
      plugins: { ...base.plugins, [plugin]: { ...prevNamespace, ...partial } },
    };
    await persist({ ...store, [id]: entry });
  });
}

/**
 * Delete an entry, atomically dropping its core fields and every plugin namespace slice. Honors
 * registered pre-expire hooks for each plugin slice the entry carries; a veto retains the entry
 * (an `extendUntil` updates `staleAfter.date`), and a throwing hook is treated as a veto
 * (fail-safe). Returns whether the entry was deleted.
 */
export function forgetMemory(id: string): Promise<{ deleted: boolean }> {
  return serialize(async () => {
    const store = await loadMemoryStore();
    const entry = store[id];
    if (!entry) {
      return { deleted: false };
    }

    let vetoed = false;
    let extendUntil: string | undefined;
    for (const hook of beforeExpireHooks) {
      if (!entry.plugins?.[hook.plugin]) continue;
      try {
        const result = await hook.fn(entry);
        if (result.vetoed) vetoed = true;
        if (result.extendUntil) extendUntil = result.extendUntil;
      } catch (error) {
        logger.warn(`memory pre-expire hook for "${hook.plugin}" threw; treating as veto:`, error);
        vetoed = true;
      }
    }

    if (vetoed) {
      if (extendUntil) {
        const retained: MemoryEntry = {
          ...entry,
          staleAfter: { ...entry.staleAfter, date: extendUntil },
          updatedAt: nowIso(),
        };
        await persist({ ...store, [id]: retained });
      }
      return { deleted: false };
    }

    const { [id]: _omit, ...rest } = store;
    await persist(rest);
    return { deleted: true };
  });
}

/**
 * Delete every entry whose `staleAfter.date` is at or before `now`, honoring pre-expire hooks via
 * {@link forgetMemory}. Entries with no `staleAfter.date` are never auto-pruned. Returns the ids
 * actually deleted.
 */
export async function pruneExpired(now: Date = deps.now()): Promise<string[]> {
  const store = await loadMemoryStore();
  const cutoff = now.toISOString();
  const candidates = Object.values(store)
    .filter((e) => e.staleAfter?.date !== undefined && e.staleAfter.date <= cutoff)
    .map((e) => e.id);

  const deleted: string[] = [];
  for (const id of candidates) {
    const { deleted: didDelete } = await forgetMemory(id);
    if (didDelete) deleted.push(id);
  }
  return deleted;
}

// Clear cache (useful for testing).
export function clearMemoryCache(): void {
  cached = null;
  writeChain = Promise.resolve();
}
