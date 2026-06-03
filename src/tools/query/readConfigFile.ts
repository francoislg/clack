import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { readInstructionFile, getConfiguredRepoNames } from "../../configurationFiles.js";
import {
  CONFIG_TARGET_FIELDS,
  validateConfigTarget,
  buildConfigPath,
  type ConfigTargetArgs,
} from "./configFieldSchemas.js";

export interface ReadConfigFileDeps {
  readInstructionFile: (filepath: string) => {
    default_content: string | null;
    custom_content: string | null;
  };
  getConfiguredRepoNames: () => string[];
}

export const defaultDeps: ReadConfigFileDeps = {
  readInstructionFile,
  getConfiguredRepoNames,
};

export function createReadConfigFileTool(
  _ctx: QueryToolContext,
  deps: ReadConfigFileDeps = defaultDeps,
) {
  return tool(
    "read_config_file",
    "Read an instruction file. Returns both default and custom content for comparison. " +
      "For role baseline files, pass `role` and `file`; for topic-scoped files, also pass `topic`. " +
      "For per-repo instruction files, pass `repo` and `file` instead.",
    CONFIG_TARGET_FIELDS,
    async (rawArgs) => {
      const args = rawArgs as ConfigTargetArgs;

      const targetError = validateConfigTarget(args);
      if (targetError !== null) {
        return errorResult(targetError);
      }

      if (args.repo !== undefined && !deps.getConfiguredRepoNames().includes(args.repo)) {
        return errorResult(
          `Unknown repository "${args.repo}". Configured repositories: ${deps.getConfiguredRepoNames().join(", ") || "(none)"}.`,
        );
      }

      const path = buildConfigPath(args);
      const result = deps.readInstructionFile(path);

      if (result.default_content === null && result.custom_content === null) {
        return errorResult(
          `File "${path}" not found. Verify the role/topic/file or repo/file combination is correct.`,
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
