import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
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
        return errorResult(`Unknown instruction file "${args.file}". Available files: ${available.join(", ")}`);
      }

      const fileContent = readInstructionFile(args.file);

      return textResult({
        file: args.file,
        hasOverride: match.hasOverride,
        hasDefault: match.hasDefault,
        status: match.hasOverride ? "customized" : match.hasDefault ? "default" : "not_created",
        content: fileContent ?? "",
      });
    }
  );
}
