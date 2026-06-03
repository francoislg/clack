import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult } from "../helpers.js";
import { listInstructionFiles, searchInstructionFiles } from "../../configurationFiles.js";
import type {
  InstructionFileListing,
  InstructionFileSearchResult,
} from "../../configurationFiles.js";

export interface ListConfigFilesDeps {
  listInstructionFiles: () => InstructionFileListing;
  searchInstructionFiles: (query: string) => InstructionFileSearchResult;
}

export const defaultDeps: ListConfigFilesDeps = {
  listInstructionFiles,
  searchInstructionFiles,
};

export function createListConfigFilesTool(
  _ctx: QueryToolContext,
  deps: ListConfigFilesDeps = defaultDeps,
) {
  return tool(
    "list_config_files",
    "List all instruction/configuration files. Returns roles (each with baseline `files` and " +
      "topic-scoped `topics`), pre-analysis context files, and per-repo instruction files. " +
      "Each file entry includes its `file` name and source `status`. The shape mirrors the " +
      "input fields used by `read_config_file` and `propose_config_update`. " +
      "Pass `query` to case-insensitively substring-search file content instead: the result " +
      "is filtered to files that contain the string, each annotated with a `matches` array of " +
      "`{ layer, line, snippet }` hits (the `default` and `custom` layers are searched " +
      "independently), plus a top-level `summary`. Omit `query` for the full listing.",
    {
      query: z
        .string()
        .optional()
        .describe(
          "Optional case-insensitive substring to search across all config file content. " +
            "Omit (or pass blank) to return the full listing without searching.",
        ),
    },
    async (args) => {
      const query = args.query?.trim();
      if (!query) {
        return textResult(deps.listInstructionFiles());
      }
      return textResult(deps.searchInstructionFiles(query));
    },
  );
}
