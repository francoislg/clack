import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../helpers.js";
import { archive, type ArchiveLeanNote } from "../../memoryRegistry.js";

export interface ArchiveDeps {
  archive: typeof archive;
}

export const defaultDeps: ArchiveDeps = { archive };

export function createArchiveTool(deps: ArchiveDeps = defaultDeps) {
  return tool(
    "archive",
    "Archive a memory entry by `id` once its work is done but worth remembering. Distills it into a lean, terminal note (summary + outcome + optional link) and removes the active entry in one step. Use this — not `forget` — when a tracked item (a fixed issue, a merged PR) is resolved and the outcome should survive for future recurrences. A plugin with live work may veto (then nothing is archived); the result reports whether it was archived.",
    {
      id: z.string().describe("The memory entry id to archive (the same stable namespaced id)"),
      summary: z.string().describe("One line: what this entry was about"),
      outcome: z
        .string()
        .describe(
          "What happened — e.g. 'Fixed in PR #123, merged 2026-06-10' or 'Abandoned: dupe of sentry:99'",
        ),
      link: z.string().optional().describe("Bare URL to the resolving artifact, if any"),
    },
    async (args) => {
      const note: ArchiveLeanNote = {
        summary: args.summary,
        outcome: args.outcome,
        link: args.link,
      };
      const { archived } = await deps.archive(args.id, note);
      return textResult({ id: args.id, archived });
    },
  );
}
