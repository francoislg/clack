import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../helpers.js";
import { pruneArchive } from "../../memoryRegistry.js";

export interface PruneArchiveDeps {
  pruneArchive: typeof pruneArchive;
}

export const defaultDeps: PruneArchiveDeps = { pruneArchive };

export function createPruneArchiveTool(deps: PruneArchiveDeps = defaultDeps) {
  return tool(
    "prune_archive",
    "Drop archived memory records older than the retention horizon. Purely mechanical (age-based, no fetch, no judgment). Call this as the final step of the daily memory review. Returns the ids removed.",
    {},
    async () => {
      const pruned = await deps.pruneArchive();
      return textResult({ prunedCount: pruned.length, pruned });
    },
  );
}
