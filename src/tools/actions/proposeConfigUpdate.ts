import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import type { IntentStore, ToolCallRecorder } from "../server.js";
import { listInstructionFiles, readInstructionFile } from "../../configurationFiles.js";

export function createProposeConfigUpdateTool(
  _ctx: QueryToolContext,
  intentStore: IntentStore,
  recorder: ToolCallRecorder
) {
  return tool(
    "propose_config_update",
    "Propose an update to an instruction/configuration file. Validates the filename and stages the intent. Returns a ref ID to use in submit_response. Default operation is 'append' which adds content to the end of the existing file. Use 'replace' only when rewriting or removing content.",
    {
      file: z.string().describe("The instruction filename to update (e.g., 'instructions.md')"),
      content: z.string().describe("The content to append (default) or the full replacement content (when operation is 'replace')."),
      operation: z.enum(["append", "replace"]).default("append").describe("'append' (default) adds content to the end of the existing file. 'replace' overwrites the entire file with the provided content."),
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

      let finalContent: string;
      if (args.operation === "replace") {
        // Replace: use the provided content as-is
        finalContent = args.content;
      } else {
        // Append: read current content and append
        const currentContent = readInstructionFile(args.file);
        if (currentContent) {
          finalContent = currentContent.trimEnd() + "\n\n" + args.content;
        } else {
          finalContent = args.content;
        }
      }

      // Stage the intent
      const ref = intentStore.stage({
        type: "config_update",
        file: args.file,
        content: finalContent,
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
