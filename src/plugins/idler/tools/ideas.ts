import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { ClackSdk } from "../../sdk.js";
import { errorResult, textResult } from "../helpers.js";
import {
  loadLedger,
  saveLedger,
  topUnits,
  upsertUnit,
  type IdlerReference,
  type IdlerUnit,
} from "../ledger.js";
import { computePriority, type WorkKind } from "../priority.js";

const WORK_KINDS = ["continue", "triage", "implement", "review", "none"] as const;

const referenceArg = z.object({
  kind: z.string().describe("Surface kind, e.g. 'github-pr', 'asana', 'sentry-issue', 'slack'"),
  id: z.string().describe("Surface id (PR number, gid, Sentry short-id, channel/ts)"),
  howToRead: z.string().describe("Exact recipe to read this surface's status (tool + args)"),
  howToComment: z.string().describe("Exact recipe to comment back on this surface (tool + args)"),
  cursor: z.string().optional().describe("Idempotency marker (last comment/event processed)"),
});

export function createListTopIdeasTool(sdk: ClackSdk) {
  return tool(
    "list_top_ideas",
    "List the highest-priority OPEN work units from the idler ledger, most important first. Use this at the start of a work fire to pick the single unit to advance. Returns at most `limit` units.",
    {
      limit: z.number().int().min(1).max(50).optional().describe("Max units to return (default 5)"),
    },
    async (args) => {
      const ledger = await loadLedger(sdk);
      const units = topUnits(ledger, args.limit ?? 5);
      return textResult({ count: units.length, ideas: units });
    },
  );
}

export function createUpsertIdeaTool(sdk: ClackSdk) {
  return tool(
    "upsert_idea",
    "Create or update a work unit in the idler ledger, keyed by its stable source-entity `key` (Sentry short-id / Asana gid / PR number). Re-emitting the same key updates the existing unit (no duplicate). Priority is computed from `kind`/`freshInput`/`blocked`. Provide `references` to append/update surfaces (with their read/comment recipes). Set `open:false` to close (e.g. done-verified or merged), `open:true` to re-open a previously closed unit.",
    {
      key: z.string().describe("Stable source-entity id — the dedup identity"),
      source: z
        .string()
        .optional()
        .describe("Provenance: 'sentry' | 'asana' | 'slack' | 'clack-pr' | …"),
      what: z.string().optional().describe("One-line statement of the work"),
      whereWeAre: z.string().optional().describe("Free-text current state"),
      nextSteps: z.string().optional().describe("Free-text next action"),
      open: z
        .boolean()
        .optional()
        .describe(
          "true = open/eligible, false = done. Defaults to keeping existing (true for new).",
        ),
      kind: z.enum(WORK_KINDS).describe("Pending-work kind, drives priority weight"),
      freshInput: z
        .boolean()
        .optional()
        .describe("New human reply / comment past cursor — raises priority"),
      blocked: z
        .boolean()
        .optional()
        .describe("Waiting on a human with no new activity — sinks priority"),
      references: z
        .array(referenceArg)
        .optional()
        .describe("Surfaces to append/update on the unit"),
    },
    async (args) => {
      const ledger = await loadLedger(sdk);
      const existing = ledger.ideas.find((u) => u.key === args.key);
      const references: IdlerReference[] = (args.references ?? []).map((r) => ({
        kind: r.kind,
        id: r.id,
        howToRead: r.howToRead,
        howToComment: r.howToComment,
        cursor: r.cursor,
      }));
      const incoming: IdlerUnit = {
        key: args.key,
        source: args.source ?? existing?.source ?? "unknown",
        what: args.what ?? existing?.what ?? "",
        whereWeAre: args.whereWeAre ?? existing?.whereWeAre ?? "",
        nextSteps: args.nextSteps ?? existing?.nextSteps ?? "",
        open: args.open ?? existing?.open ?? true,
        priority: computePriority({
          kind: args.kind as WorkKind,
          freshInput: args.freshInput,
          blocked: args.blocked,
        }),
        references,
      };
      const next = upsertUnit(ledger, incoming);
      await saveLedger(sdk, next);
      const saved = next.ideas.find((u) => u.key === args.key);
      return textResult({
        ok: true,
        key: args.key,
        priority: saved?.priority ?? incoming.priority,
      });
    },
  );
}

export function createReprioritizeTool(sdk: ClackSdk) {
  return tool(
    "reprioritize_idea",
    "Override a work unit's computed priority by its `key`. Use to manually bump or bury a unit against the automatic score.",
    {
      key: z.string().describe("Unit key to reprioritize"),
      priority: z.number().describe("New absolute priority (higher = picked sooner)"),
    },
    async (args) => {
      const ledger = await loadLedger(sdk);
      const idx = ledger.ideas.findIndex((u) => u.key === args.key);
      if (idx < 0) return errorResult(`No work unit with key "${args.key}"`);
      const ideas = [...ledger.ideas];
      ideas[idx] = { ...ideas[idx], priority: args.priority };
      await saveLedger(sdk, { ...ledger, ideas });
      return textResult({ ok: true, key: args.key, priority: args.priority });
    },
  );
}
