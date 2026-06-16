import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../helpers.js";
import { searchMemory, type SearchMemoryArgs } from "../../memoryRegistry.js";

export interface RecallDeps {
  searchMemory: typeof searchMemory;
}

export const defaultDeps: RecallDeps = { searchMemory };

export function createRecallTool(deps: RecallDeps = defaultDeps) {
  return tool(
    "recall",
    "Search Clack's memory. Returns whole entries (including any plugin data) matching an optional keyword and/or an `updatedAt` date range, newest first, paginated. Use this to check what Clack already knows before answering, or to list recent memories.",
    {
      query: z
        .string()
        .optional()
        .describe("Case-insensitive keyword; matches id/what/why/nextSteps and reference recipes"),
      from: z.string().optional().describe("ISO lower bound on updatedAt"),
      to: z.string().optional().describe("ISO upper bound on updatedAt"),
      limit: z.number().int().min(1).max(100).optional().describe("Page size (default 20)"),
      offset: z.number().int().min(0).optional().describe("Page offset (default 0)"),
    },
    async (args) => {
      const search: SearchMemoryArgs = {
        query: args.query,
        from: args.from,
        to: args.to,
        limit: args.limit,
        offset: args.offset,
      };
      const result = await deps.searchMemory(search);
      return textResult(result);
    },
  );
}
