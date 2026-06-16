import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../helpers.js";
import { rememberCore, type RememberInput } from "../../memoryRegistry.js";

export interface RememberDeps {
  rememberCore: typeof rememberCore;
}

export const defaultDeps: RememberDeps = { rememberCore };

const referenceArg = z.object({
  kind: z.string().describe("Surface kind, e.g. 'github-pr', 'asana', 'sentry-issue', 'slack'"),
  id: z.string().describe("Surface id (PR number, gid, Sentry short-id, channel/ts)"),
  howToRead: z.string().describe("Recipe to read this surface's current status (tool + args)"),
  howToComment: z.string().describe("Recipe to comment back on this surface (tool + args)"),
});

export function createRememberTool(deps: RememberDeps = defaultDeps) {
  return tool(
    "remember",
    "Save or update something worth remembering in Clack's memory — a useful fact, a decision, a reminder, or context about an entity. Keyed by a stable, namespaced `id` (e.g. 'sentry:1234', 'asana:567', 'note:deploy-needs-node-22'). Re-using an `id` updates the existing entry. Set `staleAfter.date` (ISO) when you can estimate when this stops mattering, so the daily review can prune it; `staleAfter.reason` captures the condition in words.",
    {
      id: z.string().describe("Stable namespaced id — the dedup identity (e.g. 'sentry:1234')"),
      what: z.string().optional().describe("What this is — a one-line statement"),
      why: z.string().optional().describe("Why it must be remembered"),
      staleAfter: z
        .object({
          date: z
            .string()
            .optional()
            .describe("ISO date when this stops mattering (machine-pruned)"),
          reason: z.string().optional().describe("Advisory condition for when it stops mattering"),
        })
        .optional()
        .describe("Best-guess relevance horizon"),
      nextSteps: z.string().optional().describe("Free-text next action, if any"),
      references: z
        .array(referenceArg)
        .optional()
        .describe("Surfaces this spans, each with its read/comment recipe"),
    },
    async (args) => {
      const input: RememberInput = {
        id: args.id,
        what: args.what,
        why: args.why,
        staleAfter: args.staleAfter,
        nextSteps: args.nextSteps,
        references: args.references,
      };
      const saved = await deps.rememberCore(input);
      return textResult({ ok: true, id: saved.id, updatedAt: saved.updatedAt });
    },
  );
}
