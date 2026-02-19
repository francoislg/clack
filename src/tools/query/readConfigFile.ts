import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { listInstructionFiles, readInstructionFile } from "../../configurationFiles.js";

export function createReadConfigFileTool(_ctx: QueryToolContext) {
  return tool(
    "read_config_file",
    "Read the current content of an instruction/configuration file. Returns the custom override if one exists, otherwise the default content.",
    {
      file: z.string().describe("The instruction filename to read (e.g., 'instructions.md', 'dev_instructions.md')"),
    },
    async (args) => {
      const knownFiles = listInstructionFiles();
      const match = knownFiles.find((f) => f.filename === args.file);

      if (!match) {
        const available = knownFiles.map((f) => f.filename);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            error: `Unknown instruction file "${args.file}". Available files: ${available.join(", ")}`,
          }) }],
          isError: true,
        };
      }

      const fileContent = readInstructionFile(args.file);

      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          file: args.file,
          hasOverride: match.hasOverride,
          hasDefault: match.hasDefault,
          status: match.hasOverride ? "customized" : match.hasDefault ? "default" : "not_created",
          content: fileContent ?? "",
        }, null, 2) }],
      };
    }
  );
}
