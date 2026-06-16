import type { Migration, StaticFileResult } from "./types.js";
import { logger } from "../logger.js";

/**
 * Fold the idler plugin's standalone ledger (`data/plugins/idler/ideas.json`) into the core
 * memory store (`data/state/memory.json`). Each work unit becomes one memory entry: durable
 * knowledge (`what`, `nextSteps`, `references` recipes) on the core fields, and the idler's
 * execution state (`priority`, `open`, `whereWeAre`, per-reference cursors) under the
 * `plugins.idler` namespace. The original ledger is preserved as `ideas.json.migrated` and the
 * live `ideas.json` removed.
 *
 * Idempotent: once `ideas.json` is gone, a second run hits the early no-op.
 * Blocking so it completes before the idler plugin loads.
 */

const IDEAS_PATH = "data/plugins/idler/ideas.json";
const MIGRATED_PATH = "data/plugins/idler/ideas.json.migrated";
const MEMORY_PATH = "data/state/memory.json";

type JsonPrimitive = string | number | boolean | null;
type JsonArray = JsonValue[];
interface JsonObjectShape {
  [key: string]: JsonValue;
}
type JsonValue = JsonPrimitive | JsonArray | JsonObjectShape;

function isJsonObject(value: unknown): value is JsonObjectShape {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parse(raw: string | null, label: string): JsonObjectShape | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isJsonObject(parsed) ? parsed : null;
  } catch (err) {
    logger.warn(
      `[migration 025] ${label} is not valid JSON (${err instanceof Error ? err.message : String(err)}) — skipping`,
    );
    return null;
  }
}

function entryFor(
  files: Record<string, string | null>,
  suffix: string,
): { key: string; raw: string | null } | null {
  for (const [key, raw] of Object.entries(files)) {
    if (key.endsWith(suffix)) return { key, raw };
  }
  return null;
}

function str(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

/** Namespace the entry id from the unit's `source` when the key is not already prefixed. */
function entryId(key: string, source: string): string {
  if (source && source !== "unknown" && !key.includes(":")) {
    return `${source}:${key}`;
  }
  return key;
}

function migratedEntry(unit: JsonObjectShape): { id: string; entry: JsonObjectShape } | null {
  const key = str(unit.key);
  if (key.length === 0) return null;
  const source = str(unit.source);
  const id = entryId(key, source);

  const references: JsonArray = [];
  const cursorsByRefId: JsonObjectShape = {};
  if (Array.isArray(unit.references)) {
    for (const ref of unit.references) {
      if (!isJsonObject(ref)) continue;
      const refId = str(ref.id);
      references.push({
        kind: str(ref.kind),
        id: refId,
        howToRead: str(ref.howToRead),
        howToComment: str(ref.howToComment),
      });
      if (refId.length > 0 && typeof ref.cursor === "string") {
        cursorsByRefId[refId] = ref.cursor;
      }
    }
  }

  const slot: JsonObjectShape = {
    priority: typeof unit.priority === "number" ? unit.priority : 0,
    open: typeof unit.open === "boolean" ? unit.open : true,
    whereWeAre: str(unit.whereWeAre),
    cursorsByRefId,
  };

  const entry: JsonObjectShape = {
    id,
    what: str(unit.what),
    why: "",
    nextSteps: str(unit.nextSteps),
    references,
    createdAt: "",
    updatedAt: "",
    plugins: { idler: slot },
  };
  return { id, entry };
}

/**
 * Pure transform. Given the ledger and existing memory store contents (each may be `null`),
 * returns the staged memory write, the `.migrated` backup, and the ledger drop. Exported for tests.
 */
export function foldIdlerLedgerIntoMemory(
  files: Record<string, string | null>,
): Record<string, StaticFileResult> {
  const ideasEntry = entryFor(files, IDEAS_PATH);
  const memoryEntry = entryFor(files, MEMORY_PATH);
  const migratedEntryFile = entryFor(files, MIGRATED_PATH);
  if (ideasEntry === null || memoryEntry === null || migratedEntryFile === null) {
    return {};
  }

  const ledger = parse(ideasEntry.raw, IDEAS_PATH);
  const units = ledger && Array.isArray(ledger.ideas) ? ledger.ideas : [];
  if (units.length === 0) {
    return {}; // nothing to migrate (missing, empty, or unreadable ledger)
  }

  const memory = parse(memoryEntry.raw, MEMORY_PATH) ?? {};

  let migrated = 0;
  for (const unit of units) {
    if (!isJsonObject(unit)) continue;
    const result = migratedEntry(unit);
    if (result === null) continue;
    const prev = memory[result.id];
    const existing = isJsonObject(prev) ? prev : null;
    memory[result.id] = existing ? { ...existing, ...result.entry } : result.entry;
    migrated += 1;
  }

  if (migrated === 0) {
    return {};
  }

  logger.info(`[migration 025] Folded ${migrated} idler unit(s) into ${MEMORY_PATH}`);
  return {
    [memoryEntry.key]: JSON.stringify(memory, null, 2) + "\n",
    [migratedEntryFile.key]: ideasEntry.raw ?? "",
    [ideasEntry.key]: { delete: true },
  };
}

export const migration: Migration = {
  version: 25,
  name: "Idler: fold ideas.json ledger into core data/state/memory.json",
  priority: "blocking",
  files: [IDEAS_PATH, MEMORY_PATH, MIGRATED_PATH],
  static: foldIdlerLedgerIntoMemory,
};
