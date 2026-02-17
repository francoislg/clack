import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { ToolContext } from "../types.js";
import type { IntentStore, ToolCallRecorder } from "../server.js";
import { listInstructionFiles } from "../../configurationFiles.js";

export function createProposeConfigUpdateTool(
  _ctx: ToolContext,
  intentStore: IntentStore,
  recorder: ToolCallRecorder
) {
  return tool(
    "propose_config_update",
    "Propose an update to an instruction/configuration file. Validates the filename and stages the intent. Returns a ref ID to use in submit_response.",
    {
      file: z.string().describe("The instruction filename to update (e.g., 'instructions.md')"),
      content: z.string().describe("The full new content for the file"),
    },
    async (args) => {
      // Validate filename against known instruction files
      const knownFiles = listInstructionFiles();
      const match = knownFiles.find((f) => f.filename === args.file);

      if (!match) {
        const available = knownFiles.map((f) => f.filename);
        const errorResult = {
          error: `Unknown instruction file "${args.file}". Available files: ${available.join(", ")}`,
        };
        recorder.record("propose_config_update", args as Record<string, unknown>, errorResult);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(errorResult) }],
          isError: true,
        };
      }

      // Stage the intent
      const ref = intentStore.stage({
        type: "config_update",
        file: args.file,
        content: args.content,
      });

      const result = {
        ref,
        file: args.file,
        status: match.hasOverride ? "will_overwrite_custom" : match.hasDefault ? "will_override_default" : "will_create_new",
      };

      recorder.record("propose_config_update", args as Record<string, unknown>, result);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
