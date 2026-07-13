import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { logger } from "./logger.js";
import { fileExists } from "./fs.js";
import type { JsonObject, JsonValue } from "./config.js";
import { createRecordStore } from "./state/resilientStore.js";

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
 * One outbound edge from this entry to another memory entry, labeled with a free-text `reason`.
 * One-directional (the target stores no reverse edge) and dangling-tolerant (the target need not
 * exist). This is the ONLY field expressing memory-to-memory relationships; `references` stays
 * reserved for external surfaces. Persisted as exactly `{ id, reason }` — never the recall-time
 * `archived` enrichment (see {@link RecalledMemoryLink}).
 */
export interface MemoryLink {
  id: string;
  reason: string;
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
  linkedMemories: MemoryLink[];
  createdAt: string;
  updatedAt: string;
  plugins?: { [pluginName: string]: JsonObject };
}

/**
 * A {@link MemoryLink} as surfaced by `recall`: when the target id is no longer active but exists in
 * the archive, the edge gains an `archived` snapshot of that archived record. Computed per recall
 * call and never persisted.
 */
export interface RecalledMemoryLink extends MemoryLink {
  archived?: { summary: string; outcome: string };
}

/** A {@link MemoryEntry} as surfaced by `recall` — a superset whose links may carry `archived`. */
export type RecalledMemoryEntry = Omit<MemoryEntry, "linkedMemories"> & {
  linkedMemories: RecalledMemoryLink[];
};

/** Paginated search result. `total` is the full match count; `entries` is the requested page. */
export interface MemorySearchResult {
  total: number;
  limit: number;
  offset: number;
  entries: RecalledMemoryEntry[];
}

/** Input to remember a core entry. Timestamps and plugin namespaces are managed by the registry. */
export interface RememberInput {
  id: string;
  what?: string;
  why?: string;
  staleAfter?: StaleAfter;
  nextSteps?: string;
  references?: MemoryReference[];
  linkedMemories?: MemoryLink[];
}

/**
 * A terminal "what happened" note in the archive (`data/state/memory-archive.json`). Lean by design:
 * it sheds the active entry's live-work machinery (reference recipes, `plugins` namespaces) because an
 * archived entity is done and never re-polled. Retrievable only by exact `id` — never keyword-searched.
 */
export interface ArchivedMemory {
  id: string;
  summary: string;
  outcome: string;
  link?: string;
  archivedAt: string;
}

/** Caller-supplied fields when archiving; `id` is the key and `archivedAt` is stamped by the registry. */
export interface ArchiveLeanNote {
  summary: string;
  outcome: string;
  link?: string;
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

const memoryLinkZod = z.object({
  id: z.string().default(""),
  reason: z.string().default(""),
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
  linkedMemories: z.array(memoryLinkZod).default([]),
  createdAt: z.string().default(""),
  updatedAt: z.string().default(""),
  plugins: z.record(z.string(), jsonObjectZod).optional(),
});

interface MemoryStore {
  [id: string]: MemoryEntry;
}

// Graceful (permissive) reader, like the active store: a shape mismatch logs + reads as empty rather
// than throwing or wiping. Fields tolerate missing values so one legacy record can't fail the map.
const archivedMemoryZod = z.object({
  id: z.string(),
  summary: z.string().default(""),
  outcome: z.string().default(""),
  link: z.string().optional(),
  archivedAt: z.string().default(""),
});

interface ArchiveStore {
  [id: string]: ArchivedMemory;
}

/** Default age horizon for archive pruning. A module constant, matching `DEFAULT_REVIEW_TIMEZONE`. */
export const DEFAULT_ARCHIVE_RETENTION_DAYS = 365;

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

// All mutations funnel through this promise chain so concurrent read-modify-write from core
// (remember/recall tools) and plugins (namespace merges) can't lose updates. The archive store
// shares this chain (it lives in this module) so an `archive` op's active-removal and
// archive-write happen in one serialized closure — that is what makes the cross-store move atomic.
let writeChain: Promise<void> = Promise.resolve();

function getStateDir(): string {
  return resolve(process.cwd(), "data", "state");
}

function getStorePath(): string {
  return resolve(getStateDir(), "memory.json");
}

function getArchivePath(): string {
  return resolve(getStateDir(), "memory-archive.json");
}

// Both memory files ride the shared resilient RECORD store (per-entry quarantine + freeze — one bad
// entry can no longer wipe the whole knowledge base). Store deps read the live `deps` binding so
// `setMemoryRegistryDeps` overrides at runtime are honored.
const liveStoreDeps = {
  readFile: (path: string) => deps.readFile(path, "utf-8"),
  writeFile: (path: string, data: string) => deps.writeFile(path, data),
  fileExists: (path: string) => deps.fileExists(path),
  mkdir: (path: string, opts: { recursive: boolean }) => deps.mkdir(path, opts),
};

const memStore = createRecordStore<MemoryEntry>({
  storeId: "memory",
  label: "memory",
  getPath: getStorePath,
  entrySchema: memoryEntryZod,
  deps: liveStoreDeps,
});

const archStore = createRecordStore<ArchivedMemory>({
  storeId: "memory-archive",
  label: "memory archive",
  getPath: getArchivePath,
  entrySchema: archivedMemoryZod,
  deps: liveStoreDeps,
});

export async function loadMemoryStore(): Promise<MemoryStore> {
  return memStore.load();
}

async function persist(store: MemoryStore): Promise<void> {
  await memStore.save(store);
}

export async function loadArchiveStore(): Promise<ArchiveStore> {
  return archStore.load();
}

async function persistArchive(store: ArchiveStore): Promise<void> {
  await archStore.save(store);
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

/** Exact-id point lookup against the archive. The archive is never keyword-searched — this is the
 * only way back in, for a caller that already holds the stable key (idler sync on re-discovery). */
export async function getArchived(id: string): Promise<ArchivedMemory | null> {
  const store = await loadArchiveStore();
  return store[id] ?? null;
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
  // Link reasons are searchable; link ids are not, so one entry never surfaces on a search for another's id.
  const linkText = entry.linkedMemories.map((l) => l.reason).join(" ");
  const text = `${entry.id} ${entry.what} ${entry.why} ${entry.nextSteps ?? ""} ${refText} ${linkText}`;
  return text.toLowerCase();
}

/**
 * Build the recall view of an entry: for any link whose target is no longer active, attach an
 * `archived` snapshot when the archive holds it. Builds fresh edge/entry objects so the cached
 * store is never mutated — the `archived` field is recall-time only and never persisted.
 */
function toRecalledEntry(
  entry: MemoryEntry,
  active: MemoryStore,
  archive: ArchiveStore,
): RecalledMemoryEntry {
  const linkedMemories: RecalledMemoryLink[] = entry.linkedMemories.map((link) => {
    if (active[link.id]) {
      return { id: link.id, reason: link.reason };
    }
    const archived = archive[link.id];
    return archived
      ? {
          id: link.id,
          reason: link.reason,
          archived: { summary: archived.summary, outcome: archived.outcome },
        }
      : { id: link.id, reason: link.reason };
  });
  return { ...entry, linkedMemories };
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
  const page = matches.slice(start, start + Math.max(0, limit));
  const archive = await loadArchiveStore();
  const entries = page.map((entry) => toRecalledEntry(entry, store, archive));
  return { total, limit, offset, entries };
}

// ============================================================================
// Writes (serialized)
// ============================================================================

/**
 * Create or update a core memory entry by `id`. Preserves any existing `plugins` namespaces and
 * `createdAt`; only touches the core knowledge fields and bumps `updatedAt`. Omitted fields keep
 * their prior value (or sensible defaults on first create). Returns the saved entry together
 * with the entry it replaced (`previous` is `undefined` on first create) so callers can surface
 * overwrite feedback.
 */
export function rememberCore(
  input: RememberInput,
): Promise<{ entry: MemoryEntry; previous: MemoryEntry | undefined }> {
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
      linkedMemories: input.linkedMemories ?? existing?.linkedMemories ?? [],
      createdAt: existing?.createdAt || ts,
      updatedAt: ts,
      ...(existing?.plugins ? { plugins: existing.plugins } : {}),
    };
    const next: MemoryStore = { ...store, [input.id]: entry };
    await persist(next);
    return { entry, previous: existing };
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
 * record is meaningless and no placeholder is created. Serialized.
 *
 * By default (`touch: true`) bumps `updatedAt`. Pass `touch: false` for a bookkeeping write that
 * records a plugin's processing of an entry rather than a change to the remembered knowledge — it
 * preserves `updatedAt` so a caller can snapshot it and later detect genuine content changes
 * against that snapshot.
 */
export function mergeMemoryNamespace(
  plugin: string,
  id: string,
  partial: JsonObject,
  opts: { touch?: boolean } = {},
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
      updatedAt: opts.touch === false ? base.updatedAt : nowIso(),
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
async function runBeforeExpireHooks(
  entry: MemoryEntry,
): Promise<{ vetoed: boolean; extendUntil?: string }> {
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
  return { vetoed, extendUntil };
}

/** On a veto, persist the entry with its staleAfter.date pushed to `extendUntil` (no-op without one). */
async function persistVetoExtension(
  store: MemoryStore,
  entry: MemoryEntry,
  extendUntil: string | undefined,
): Promise<void> {
  if (!extendUntil) {
    return;
  }
  const retained: MemoryEntry = {
    ...entry,
    staleAfter: { ...entry.staleAfter, date: extendUntil },
    updatedAt: nowIso(),
  };
  await persist({ ...store, [entry.id]: retained });
}

export function forgetMemory(id: string): Promise<{ deleted: boolean }> {
  return serialize(async () => {
    const store = await loadMemoryStore();
    const entry = store[id];
    if (!entry) {
      return { deleted: false };
    }

    const { vetoed, extendUntil } = await runBeforeExpireHooks(entry);
    if (vetoed) {
      await persistVetoExtension(store, entry, extendUntil);
      return { deleted: false };
    }

    const { [id]: _omit, ...rest } = store;
    await persist(rest);
    return { deleted: true };
  });
}

/**
 * Atomically distill an active entry into a lean archive record and remove it from the active store.
 * Runs in ONE serialized closure on the shared write chain, so a throw in either persist can't
 * interleave with other writers. Honors the same pre-expire veto as {@link forgetMemory}: a veto (or a
 * throwing hook) retains the active entry and writes NO archive record — state is never destroyed
 * against a plugin's veto. The archive record is written BEFORE the active removal so a failure leaves
 * the entry recoverable in the active store (in-both is safe; in-neither would lose it).
 */
export function archive(id: string, note: ArchiveLeanNote): Promise<{ archived: boolean }> {
  return serialize(async () => {
    const store = await loadMemoryStore();
    const entry = store[id];
    if (!entry) {
      return { archived: false };
    }

    const { vetoed, extendUntil } = await runBeforeExpireHooks(entry);
    if (vetoed) {
      await persistVetoExtension(store, entry, extendUntil);
      return { archived: false };
    }

    const archiveStore = await loadArchiveStore();
    const record: ArchivedMemory = {
      id,
      summary: note.summary,
      outcome: note.outcome,
      ...(note.link ? { link: note.link } : {}),
      archivedAt: nowIso(),
    };
    await persistArchive({ ...archiveStore, [id]: record });

    const { [id]: _omit, ...rest } = store;
    await persist(rest);
    return { archived: true };
  });
}

/**
 * Drop archived records whose `archivedAt` is older than `retentionDays`. Purely mechanical — no fetch,
 * no veto (the record is already terminal). Records with no `archivedAt` are never pruned (age unknown).
 * Returns the ids removed.
 */
export function pruneArchive(
  now: Date = deps.now(),
  retentionDays = DEFAULT_ARCHIVE_RETENTION_DAYS,
): Promise<string[]> {
  return serialize(async () => {
    const store = await loadArchiveStore();
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const expired = Object.values(store)
      .filter((r) => r.archivedAt !== "" && r.archivedAt <= cutoff)
      .map((r) => r.id);
    if (expired.length === 0) {
      return [];
    }
    const expiredSet = new Set(expired);
    const next = Object.fromEntries(
      Object.entries(store).filter(([recordId]) => !expiredSet.has(recordId)),
    );
    await persistArchive(next);
    return expired;
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

// Clear caches (useful for testing). Resets both stores' caches and the shared write chain.
export function clearMemoryCache(): void {
  memStore.clearCache();
  archStore.clearCache();
  writeChain = Promise.resolve();
}
