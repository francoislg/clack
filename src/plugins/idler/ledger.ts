import { z } from "zod";
import type { ClackSdk } from "../sdk.js";

/** The SDK surface the ledger I/O needs — narrowed so tests can supply a plain fake. */
export type LedgerSdk = Pick<ClackSdk, "readFile" | "writeFile" | "logger">;

const LEDGER_PATH = "ideas.json";

/**
 * A self-describing surface a work unit spans (Asana task, GitHub PR, Slack thread). `howToRead`
 * and `howToComment` are free-text recipes the sync task writes at discovery; `cursor` is the
 * idempotency marker so the same activity isn't re-processed or re-commented.
 */
const referenceSchema = z.object({
  kind: z.string(),
  id: z.string(),
  howToRead: z.string().default(""),
  howToComment: z.string().default(""),
  cursor: z.string().optional(),
});

const unitSchema = z.object({
  /** Stable source-entity key (Sentry short-id / Asana gid / PR number) — the dedup identity. */
  key: z.string(),
  open: z.boolean().default(true),
  priority: z.number().default(0),
  source: z.string().default("unknown"),
  what: z.string().default(""),
  whereWeAre: z.string().default(""),
  nextSteps: z.string().default(""),
  references: z.array(referenceSchema).default([]),
});

const ledgerSchema = z.object({
  ideas: z.array(unitSchema).default([]),
});

export type IdlerReference = z.infer<typeof referenceSchema>;
export type IdlerUnit = z.infer<typeof unitSchema>;
export type IdlerLedger = z.infer<typeof ledgerSchema>;

/**
 * Graceful reader (project convention for persisted state): on missing/malformed file, log and
 * return the empty ledger rather than throwing or silently wiping. A too-strict schema here would
 * destroy real state, so fields are permissive with defaults.
 */
export async function loadLedger(sdk: LedgerSdk): Promise<IdlerLedger> {
  const raw = await sdk.readFile(LEDGER_PATH);
  if (raw === null) return { ideas: [] };
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    sdk.logger.warn(`ideas.json is not valid JSON; using empty ledger: ${String(err)}`);
    return { ideas: [] };
  }
  const result = ledgerSchema.safeParse(parsedJson);
  if (!result.success) {
    sdk.logger.warn(`ideas.json failed schema validation; using empty ledger: ${result.error}`);
    return { ideas: [] };
  }
  return result.data;
}

export async function saveLedger(sdk: LedgerSdk, ledger: IdlerLedger): Promise<void> {
  await sdk.writeFile(LEDGER_PATH, JSON.stringify(ledger, null, 2));
}

/**
 * Insert or update a unit by its stable `key` (dedup): a re-emitted entity updates the existing
 * unit instead of creating a duplicate. `incoming` scalar fields win (so the caller re-opens a
 * done unit by passing `open: true`, or closes by passing `open: false`); references append-merge.
 * Returns a new ledger.
 */
export function upsertUnit(ledger: IdlerLedger, incoming: IdlerUnit): IdlerLedger {
  const idx = ledger.ideas.findIndex((u) => u.key === incoming.key);
  if (idx === -1) {
    return { ...ledger, ideas: [...ledger.ideas, incoming] };
  }
  const existing = ledger.ideas[idx];
  const merged: IdlerUnit = {
    ...existing,
    ...incoming,
    references: mergeReferences(existing.references, incoming.references),
  };
  const ideas = [...ledger.ideas];
  ideas[idx] = merged;
  return { ...ledger, ideas };
}

/** Merge references by (kind, id): incoming fields win, but a populated value never reverts to empty. */
function mergeReferences(existing: IdlerReference[], incoming: IdlerReference[]): IdlerReference[] {
  const byKey = new Map(existing.map((r) => [`${r.kind}:${r.id}`, r]));
  for (const ref of incoming) {
    const k = `${ref.kind}:${ref.id}`;
    const prev = byKey.get(k);
    byKey.set(k, prev ? { ...prev, ...ref } : ref);
  }
  return [...byKey.values()];
}

export function openUnits(ledger: IdlerLedger): IdlerUnit[] {
  return ledger.ideas.filter((u) => u.open);
}

/** Top-N open units by descending priority — keeps the work task's context bounded. */
export function topUnits(ledger: IdlerLedger, limit: number): IdlerUnit[] {
  return openUnits(ledger)
    .slice()
    .sort((a, b) => b.priority - a.priority)
    .slice(0, Math.max(0, limit));
}
