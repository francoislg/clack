import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../helpers.js";
import { getArchived } from "../../memoryRegistry.js";

export interface GetArchivedDeps {
  getArchived: typeof getArchived;
}

export const defaultDeps: GetArchivedDeps = { getArchived };

export function createGetArchivedTool(deps: GetArchivedDeps = defaultDeps) {
  return tool(
    "get_archived",
    "Look up an archived (resolved) memory entry by its exact stable `id`. Returns the lean note (summary, outcome, optional link, archivedAt) or null if nothing was archived under that id. Use this before treating a re-discovered entity (e.g. a re-alerting issue) as brand-new work — a hit tells you it was handled before and how it resolved. This is an exact-id lookup only; `recall` does not search the archive.",
    {
      id: z.string().describe("The exact stable namespaced id to look up (e.g. 'sentry:1234')"),
    },
    async (args) => {
      const record = await deps.getArchived(args.id);
      return textResult({ id: args.id, found: record !== null, record });
    },
  );
}
