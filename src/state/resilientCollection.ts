import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { z } from "zod";

import { logger } from "../logger.js";
import { fileExists } from "../fs.js";

// ============================================================================
// Types
// ============================================================================

export type CollectionKind = "array" | "record";

/** A JSON value read from disk — validated per-element before any typed use. */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonRecord = { [key: string]: JsonValue };

/** One quarantined entry as surfaced to the owner DM and the Home Tab panel. */
export interface QuarantineEntry {
  /** Array collections: the positional index as a string. Record collections: the original key. */
  key: string;
  /** Failing zod field path (e.g. `timezone`), or `(root)` when unattributable. */
  field: string;
  /** The validation error message. */
  error: string;
}

/** Internal quarantine representation — a raw value tagged with its key, verbatim. */
export interface QuarantineItem {
  key: string;
  raw: unknown;
}

/** What the load path reports to the registered notifier. */
export interface QuarantineReport {
  /** Human-readable store label, e.g. "auto-respond rules". */
  source: string;
  /** Newly-quarantined entries this load (empty on a freeze-only report). */
  quarantined: QuarantineEntry[];
  /** Present when a total parse failure froze persistence; names the snapshot (or null). */
  frozen?: { snapshotPath: string | null };
}

/** A resolved collection: an array of valid entries, or a keyed record of them. */
export type ValidCollection<T> = T[] | Record<string, T>;

// ============================================================================
// Freeze state (per file path, in-memory)
// ============================================================================

const frozenPaths = new Set<string>();

/** True while persistence for `path` is frozen after a total load failure. */
export function isFrozen(path: string): boolean {
  return frozenPaths.has(path);
}

/** Clear the freeze for `path` (used by tests / a fresh-process reset). */
export function clearFreeze(path: string): void {
  frozenPaths.delete(path);
}

// ============================================================================
// Pure per-element parse (no I/O) — the seam every consumer shares
// ============================================================================

const labelZod = z.object({
  id: z.string().optional().catch(undefined),
  name: z.string().optional().catch(undefined),
});

/** Prefer the raw entry's own `id`/`name` as a stable display key, falling back to `fallback`. */
function labelFor(raw: unknown, fallback: string): string {
  const parsed = labelZod.safeParse(raw);
  const label = parsed.success ? parsed.data.id || parsed.data.name : undefined;
  return label || fallback;
}

function describeFailure(raw: unknown, key: string, error: z.ZodError): QuarantineEntry {
  const issue = error.issues[0];
  return {
    key: labelFor(raw, key),
    field: issue && issue.path.length > 0 ? issue.path.join(".") : "(root)",
    error: issue?.message ?? error.message,
  };
}

export interface ParseOptions<T> {
  entrySchema: z.ZodType<T>;
  kind: CollectionKind;
  /** Array files: the natural collection key (`"jobs"`, `"rules"`). Ignored for record kind. */
  collectionKey?: string;
  /** Array files: a legacy quarantine key to also read (e.g. cron's `quarantinedJobs`). */
  legacyQuarantineKey?: string;
}

export interface ParseResult<T> {
  valid: ValidCollection<T>;
  quarantine: QuarantineItem[];
  /** Entries quarantined by THIS parse (excludes ones carried from disk) — drives notification. */
  newly: QuarantineEntry[];
}

function isPlainObject(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Dedup a quarantine list by key, keeping the LAST occurrence (a newly-failed entry wins over a
 *  stale carried one under the same key), so retry/delete-by-key can never target the wrong item. */
function dedupeByKey(items: QuarantineItem[]): QuarantineItem[] {
  return [...new Map(items.map((item) => [item.key, item])).values()];
}

function asArray(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Per-element parse an already-`JSON.parse`d top-level value. Valid entries load; each invalid entry
 * is quarantined verbatim, keyed by index (array) or key (record). Pre-existing on-disk quarantine is
 * carried unchanged. Returns `"unusable"` when the top level isn't the expected object shape — the
 * caller then freezes rather than treating it as empty.
 */
export function parseResilientCollection<T>(
  raw: unknown,
  opts: ParseOptions<T>,
): ParseResult<T> | "unusable" {
  if (!isPlainObject(raw)) return "unusable";
  const obj = raw;

  if (opts.kind === "array") {
    const collectionKey = opts.collectionKey ?? "entries";
    const rawItems = asArray(obj[collectionKey]);
    const carried: JsonValue[] = [
      ...asArray(obj.quarantined),
      ...(opts.legacyQuarantineKey ? asArray(obj[opts.legacyQuarantineKey]) : []),
    ];
    const valid: T[] = [];
    const quarantine: QuarantineItem[] = carried.map((item, i) => ({
      key: labelFor(item, `carried-${i}`),
      raw: item,
    }));
    const newly: QuarantineEntry[] = [];
    for (let i = 0; i < rawItems.length; i++) {
      const result = opts.entrySchema.safeParse(rawItems[i]);
      if (result.success) {
        valid.push(result.data);
      } else {
        const entry = describeFailure(rawItems[i], String(i), result.error);
        quarantine.push({ key: entry.key, raw: rawItems[i] });
        newly.push(entry);
      }
    }
    return { valid, quarantine: dedupeByKey(quarantine), newly };
  }

  // record kind — accept the wrapped `{ entries, quarantined }` shape OR a legacy bare record.
  // Wrapped iff `entries` is an object AND every top-level key is `entries`/`quarantined`; a legacy
  // bare record (keyed by user/entity ids) fails that test, so a stray user key can't be misread.
  const topKeys = Object.keys(obj);
  const wrapped =
    isPlainObject(obj.entries) && topKeys.every((k) => k === "entries" || k === "quarantined");
  const entries = wrapped && isPlainObject(obj.entries) ? obj.entries : obj;
  const carriedRecord = wrapped && isPlainObject(obj.quarantined) ? obj.quarantined : {};
  const valid: Record<string, T> = {};
  const quarantine: QuarantineItem[] = Object.entries(carriedRecord).map(([key, raw]) => ({
    key,
    raw,
  }));
  const newly: QuarantineEntry[] = [];
  for (const [key, value] of Object.entries(entries)) {
    const result = opts.entrySchema.safeParse(value);
    if (result.success) {
      valid[key] = result.data;
    } else {
      const failure = describeFailure(value, key, result.error);
      quarantine.push({ key, raw: value });
      newly.push({ ...failure, key });
    }
  }
  return { valid, quarantine, newly };
}

// ============================================================================
// Serialize (round-trip the quarantine; omit when empty)
// ============================================================================

/** Build the on-disk object (consumed only by `JSON.stringify`, hence the `unknown` return). */
export function serializeResilientCollection<T>(
  valid: ValidCollection<T>,
  quarantine: QuarantineItem[],
  opts: Pick<ParseOptions<T>, "kind" | "collectionKey">,
): unknown {
  const quarantinedArray = quarantine.map((q) => q.raw);
  if (opts.kind === "array") {
    const collectionKey = opts.collectionKey ?? "entries";
    return {
      [collectionKey]: valid,
      ...(quarantine.length > 0 ? { quarantined: quarantinedArray } : {}),
    };
  }
  const quarantined = Object.fromEntries(quarantine.map((q) => [q.key, q.raw]));
  return {
    entries: valid,
    ...(quarantine.length > 0 ? { quarantined } : {}),
  };
}

// ============================================================================
// Snapshot + freeze (total failure)
// ============================================================================

/**
 * Snapshot `path` (best-effort) and freeze its persistence. The freeze is set even if the snapshot
 * copy fails, so a save can never overwrite the corrupt original. Returns the snapshot path, or null
 * if it could not be written.
 */
export async function freezeAndSnapshot(
  path: string,
  content: string | null,
  error: unknown,
): Promise<string | null> {
  frozenPaths.add(path);
  logger.error(`resilient-state: unreadable file ${path} — freezing to protect it:`, error);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let snapshotPath: string | null =
    path.replace(/\.json$/, "") + `.corrupt-${stamp}-${randomUUID().slice(0, 8)}.json`;
  try {
    if (content !== null) {
      await writeFile(snapshotPath, content);
    } else {
      await copyFile(path, snapshotPath);
    }
    logger.error(`resilient-state: corrupt file snapshotted to ${snapshotPath}`);
  } catch (copyErr) {
    logger.error(`resilient-state: failed to snapshot ${path} (freeze still active):`, copyErr);
    snapshotPath = null;
  }
  return snapshotPath;
}

// ============================================================================
// Async file loader — the common path
// ============================================================================

export interface LoadOptions<T> extends ParseOptions<T> {
  path: string;
  /** Store label for owner notifications. */
  source: string;
  /** Injected file reader. */
  readFile: (path: string) => Promise<string>;
  /** Injected existence check (defaults to the real one) so pure-mock stores stay in control. */
  fileExists?: (path: string) => Promise<boolean>;
  /** Best-effort quarantine/freeze sink. */
  onQuarantine?: (report: QuarantineReport) => void;
}

export interface LoadResult<T> {
  valid: ValidCollection<T>;
  quarantine: QuarantineItem[];
  frozen: boolean;
}

function emptyValid<T>(kind: CollectionKind): ValidCollection<T> {
  return kind === "array" ? [] : {};
}

export async function loadResilientCollection<T>(opts: LoadOptions<T>): Promise<LoadResult<T>> {
  const exists = opts.fileExists ?? fileExists;
  if (!(await exists(opts.path))) {
    return { valid: emptyValid<T>(opts.kind), quarantine: [], frozen: false };
  }

  let content: string | null = null;
  let parsed: ParseResult<T> | "unusable";
  try {
    content = await opts.readFile(opts.path);
    parsed = parseResilientCollection<T>(JSON.parse(content), opts);
  } catch (error) {
    const snapshotPath = await freezeAndSnapshot(opts.path, content, error);
    opts.onQuarantine?.({ source: opts.source, quarantined: [], frozen: { snapshotPath } });
    return { valid: emptyValid<T>(opts.kind), quarantine: [], frozen: true };
  }

  if (parsed === "unusable") {
    const snapshotPath = await freezeAndSnapshot(
      opts.path,
      content,
      new Error("top-level shape is not a usable object"),
    );
    opts.onQuarantine?.({ source: opts.source, quarantined: [], frozen: { snapshotPath } });
    return { valid: emptyValid<T>(opts.kind), quarantine: [], frozen: true };
  }

  // A successful full parse clears any freeze left by a prior corrupt load.
  frozenPaths.delete(opts.path);
  if (parsed.newly.length > 0) {
    logger.error(
      `resilient-state: ${opts.source} quarantined ${parsed.newly.length} invalid entry(ies)`,
    );
    opts.onQuarantine?.({ source: opts.source, quarantined: parsed.newly });
  }
  return { valid: parsed.valid, quarantine: parsed.quarantine, frozen: false };
}

// ============================================================================
// Freeze-aware write helper
// ============================================================================

/**
 * Write `serialized` to `path` as pretty JSON, UNLESS persistence for `path` is frozen (then it logs
 * and returns `false` without touching disk). Creates the parent dir if needed.
 */
export interface WriteImpls {
  writeFile?: (path: string, data: string) => Promise<void>;
  fileExists?: (path: string) => Promise<boolean>;
  mkdir?: (path: string, opts: { recursive: boolean }) => Promise<string | undefined>;
}

export async function writeResilientCollection(
  path: string,
  serialized: unknown,
  impls: WriteImpls = {},
): Promise<boolean> {
  if (isFrozen(path)) {
    logger.error(`resilient-state: ${path} is frozen (corrupt file) — refusing to overwrite`);
    return false;
  }
  const dir = dirname(path);
  const exists = impls.fileExists ?? fileExists;
  if (!(await exists(dir))) {
    await (impls.mkdir ?? mkdir)(dir, { recursive: true });
  }
  await (impls.writeFile ?? writeFile)(path, JSON.stringify(serialized, null, 2));
  return true;
}

// ============================================================================
// Quarantine mutation (Home Tab Retry / Delete) — pure over a quarantine list
// ============================================================================

export interface RetryOutcome<T> {
  ok: boolean;
  /** The re-validated entry, present when `ok`. */
  entry?: T;
  /** The quarantine list with the retried entry removed, present when `ok`. */
  remaining?: QuarantineItem[];
  error?: string;
}

/** Re-validate the quarantined entry at `key`; on success return it + the pruned quarantine list. */
export function retryQuarantinedEntry<T>(
  quarantine: QuarantineItem[],
  key: string,
  entrySchema: z.ZodType<T>,
): RetryOutcome<T> {
  const index = quarantine.findIndex((q) => q.key === key);
  if (index === -1) return { ok: false, error: "not found" };
  const result = entrySchema.safeParse(quarantine[index].raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    return { ok: false, error: issue?.message ?? result.error.message };
  }
  return {
    ok: true,
    entry: result.data,
    remaining: quarantine.filter((_, i) => i !== index),
  };
}

/** Remove the quarantined entry at `key`; returns the pruned list, or null if not found. */
export function deleteQuarantinedEntry(
  quarantine: QuarantineItem[],
  key: string,
): QuarantineItem[] | null {
  const index = quarantine.findIndex((q) => q.key === key);
  if (index === -1) return null;
  return quarantine.filter((_, i) => i !== index);
}

/** Displayable summaries for the Home Tab (recomputes the current error per entry). */
export function summarizeQuarantine<T>(
  quarantine: QuarantineItem[],
  entrySchema: z.ZodType<T>,
): QuarantineEntry[] {
  return quarantine.map((item) => {
    const result = entrySchema.safeParse(item.raw);
    if (result.success) {
      return { key: item.key, field: "—", error: "revalidated — click Retry to restore" };
    }
    return describeFailure(item.raw, item.key, result.error);
  });
}
