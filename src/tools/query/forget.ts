import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../helpers.js";
import { forgetMemory } from "../../memoryRegistry.js";

export interface ForgetDeps {
  forgetMemory: typeof forgetMemory;
}

export const defaultDeps: ForgetDeps = { forgetMemory };

export function createForgetTool(deps: ForgetDeps = defaultDeps) {
  return tool(
    "forget",
    "Delete a memory entry by `id` when it is no longer relevant. This drops the core record and every plugin's namespace data on it. A plugin with live work on the entry may veto the deletion (in which case the entry is retained); the result reports whether it was actually deleted.",
    {
      id: z.string().describe("The memory entry id to forget"),
    },
    async (args) => {
      const { deleted } = await deps.forgetMemory(args.id);
      return textResult({ id: args.id, deleted });
    },
  );
}
