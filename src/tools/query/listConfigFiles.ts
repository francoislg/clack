import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { listInstructionFiles } from "../../configurationFiles.js";

export function createListConfigFilesTool(_ctx: QueryToolContext) {
  return tool(
    "list_config_files",
    "List all instruction/configuration files that can be edited. Shows which files have custom overrides and which use defaults.",
    {
      _placeholder: z.boolean().optional().describe("Unused parameter (tool takes no input)"),
    },
    async () => {
      const files = listInstructionFiles();

      const result = files.map((f) => ({
        filename: f.filename,
        status: f.hasOverride ? "customized" : f.hasDefault ? "default" : "missing",
      }));

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
