import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { readInstructionFile } from "../../configurationFiles.js";
import {
  ROLE_ENUM,
  TOPIC_PATTERN,
  FILE_PATTERN,
  buildInstructionPath,
} from "./configFieldSchemas.js";

export interface ReadConfigFileDeps {
  readInstructionFile: (filepath: string) => {
    default_content: string | null;
    custom_content: string | null;
  };
}

export const defaultDeps: ReadConfigFileDeps = {
  readInstructionFile,
};

export function createReadConfigFileTool(
  _ctx: QueryToolContext,
  deps: ReadConfigFileDeps = defaultDeps,
) {
  return tool(
    "read_config_file",
    "Read an instruction file. Returns both default and custom content for comparison. " +
      "For baseline files, pass `role` and `file`. For topic-scoped files, also pass `topic`.",
    {
      role: ROLE_ENUM.describe("The role directory (one of: user, dev, admin, owner)"),
      topic: TOPIC_PATTERN.optional().describe(
        "Optional topic name for topic-scoped instruction files (e.g., 'metabase'). Omit for baseline files.",
      ),
      file: FILE_PATTERN.describe(
        "The bare filename ending in `.md` (e.g., 'identity.md'). No slashes — use the `topic` field for topic-scoped paths.",
      ),
    },
    async (args) => {
      const path = buildInstructionPath(args.role, args.topic, args.file);
      const result = deps.readInstructionFile(path);

      if (result.default_content === null && result.custom_content === null) {
        return errorResult(
          `File "${path}" not found. Verify the role/topic/file combination is correct.`,
        );
      }

      return textResult({
        file: path,
        default_content: result.default_content,
        custom_content: result.custom_content,
      });
    },
  );
}
