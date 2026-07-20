import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { ClackSdk } from "../../../plugins-sdk/sdk.js";
import { errorResult, textResult } from "../../../plugins-sdk/sdk.js";
import { computePriority, type WorkKind } from "../priority.js";
import { idlerSlotSchema, parseSlot, type IdlerSlot } from "../slice.js";

const WORK_KINDS = ["continue", "triage", "implement", "review", "none"] as const;

const referenceArg = z.object({
  kind: z.string().describe("Surface kind, e.g. 'github-pr', 'asana', 'sentry-issue', 'slack'"),
  id: z.string().describe("Surface id (PR number, gid, Sentry short-id, channel/ts)"),
  howToRead: z.string().describe("Exact recipe to read this surface's status (tool + args)"),
  howToComment: z.string().describe("Exact recipe to comment back on this surface (tool + args)"),
});

export function createListTopIdeasTool(sdk: ClackSdk) {
  return tool(
    "list_top_ideas",
    'List OPEN idler work units. `sort_by: "priority"` (default) returns the highest-priority units first — use it in a WORK fire to pick the single unit to advance. `sort_by: "coldest"` returns the least-recently-attended units first (oldest `updatedAt`) — use it in a SYNC fire to rotate through what needs a re-check (re-verifying a unit bumps its `updatedAt`, rotating it to the back). Returns at most `limit` units (default 5), each merging the entry\'s core knowledge with the idler work-state plus its `updatedAt`, `staleAfter`, and a computed `overdue` flag.',
    {
      limit: z.number().int().min(1).max(50).optional().describe("Max units to return (default 5)"),
      sort_by: z
        .enum(["priority", "coldest"])
        .optional()
        .describe(
          'Ordering: "priority" (default — highest priority first, the work fire\'s selection order) or "coldest" (oldest `updatedAt` first — the sync rotation).',
        ),
    },
    async (args) => {
      const now = new Date().toISOString();
      const entries = await sdk.memory.list();
      const open: Array<{ entry: (typeof entries)[number]; slot: IdlerSlot }> = [];
      for (const entry of entries) {
        const slot = parseSlot(entry.plugins?.idler);
        if (slot && slot.open) open.push({ entry, slot });
      }
      if (args.sort_by === "coldest") {
        open.sort((a, b) =>
          a.entry.updatedAt < b.entry.updatedAt
            ? -1
            : a.entry.updatedAt > b.entry.updatedAt
              ? 1
              : 0,
        );
      } else {
        open.sort((a, b) => b.slot.priority - a.slot.priority);
      }
      const ideas = open.slice(0, args.limit ?? 5).map(({ entry, slot }) => ({
        id: entry.id,
        what: entry.what,
        whereWeAre: slot.whereWeAre,
        nextSteps: entry.nextSteps ?? "",
        priority: slot.priority,
        updatedAt: entry.updatedAt,
        ...(entry.staleAfter ? { staleAfter: entry.staleAfter } : {}),
        overdue: entry.staleAfter?.date != null && entry.staleAfter.date < now,
        references: entry.references,
        cursorsByRefId: slot.cursorsByRefId,
      }));
      return textResult({ count: ideas.length, ideas });
    },
  );
}

export function createUpsertIdeaTool(sdk: ClackSdk) {
  return tool(
    "upsert_idea",
    "Create or update an idler work unit, keyed by its stable source-entity `id` (e.g. 'sentry:1234', 'asana:567'). Writes durable knowledge (`what`/`why`/`references`/`staleAfter`) to core memory and the idler work-state (priority from `kind`/`freshInput`/`blocked`, `open`, `whereWeAre`, cursors) to its namespace. Set `open:false` to close (done/merged); `open:true` re-opens.",
    {
      id: z.string().describe("Stable source-entity id — the dedup identity"),
      what: z.string().optional().describe("One-line statement of the work"),
      why: z.string().optional().describe("Why this matters / why it is tracked"),
      nextSteps: z.string().optional().describe("Free-text next action"),
      whereWeAre: z.string().optional().describe("Free-text current execution state"),
      staleAfter: z
        .object({
          date: z.string().optional().describe("ISO date when this stops mattering"),
          reason: z.string().optional().describe("Advisory condition for when it stops mattering"),
        })
        .optional()
        .describe("Best-guess relevance horizon (lets the daily review prune it)"),
      open: z
        .boolean()
        .optional()
        .describe(
          "true = open/eligible, false = done. Defaults to keeping existing (true for new).",
        ),
      ignore: z
        .boolean()
        .optional()
        .describe(
          "Mark a memory entry as not-idler-work: snapshots ignoredAt so the memory scan skips it until its content changes. Skips work-unit creation; kind is not required.",
        ),
      kind: z
        .enum(WORK_KINDS)
        .optional()
        .describe("Pending-work kind, drives priority weight. Required unless `ignore` is set."),
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
        .describe("Surfaces to attach to the core entry (with their read/comment recipes)"),
      cursors: z
        .record(z.string(), z.string())
        .optional()
        .describe("Per-reference cursor advances to merge, keyed by reference id"),
    },
    async (args) => {
      const slot = sdk.memory.data(idlerSlotSchema);

      if (args.ignore) {
        const entry = await sdk.memory.get(args.id);
        if (!entry) {
          return errorResult(`No memory entry with id "${args.id}" to ignore`);
        }
        await slot.merge(
          args.id,
          { ignoredAt: entry.updatedAt, open: false, priority: 0 },
          { touch: false },
        );
        return textResult({ ok: true, id: args.id, ignored: true });
      }

      if (!args.kind) {
        return errorResult("kind is required unless `ignore` is set");
      }

      await sdk.memory.remember({
        id: args.id,
        what: args.what,
        why: args.why,
        nextSteps: args.nextSteps,
        staleAfter: args.staleAfter,
        references: args.references,
      });

      const existing = await slot.get(args.id);
      const wasIgnored = existing?.ignoredAt != null;
      const priority = computePriority({
        kind: args.kind as WorkKind,
        freshInput: args.freshInput,
        blocked: args.blocked,
      });
      const next: IdlerSlot = {
        priority,
        open: args.open ?? (wasIgnored ? true : (existing?.open ?? true)),
        whereWeAre: args.whereWeAre ?? existing?.whereWeAre ?? "",
        cursorsByRefId: { ...existing?.cursorsByRefId, ...args.cursors },
        ignoredAt: undefined,
      };
      await slot.merge(args.id, next);
      return textResult({ ok: true, id: args.id, priority });
    },
  );
}

export function createReprioritizeTool(sdk: ClackSdk) {
  return tool(
    "reprioritize_idea",
    "Override an idler work unit's computed priority by its `id`. Use to manually bump or bury a unit against the automatic score.",
    {
      id: z.string().describe("Unit id to reprioritize"),
      priority: z.number().describe("New absolute priority (higher = picked sooner)"),
    },
    async (args) => {
      const slot = sdk.memory.data(idlerSlotSchema);
      const existing = await slot.get(args.id);
      if (!existing) return errorResult(`No idler work unit with id "${args.id}"`);
      await slot.merge(args.id, { priority: args.priority });
      return textResult({ ok: true, id: args.id, priority: args.priority });
    },
  );
}
