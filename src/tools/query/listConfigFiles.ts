import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult } from "../helpers.js";
import { listInstructionFiles } from "../../configurationFiles.js";
import type { InstructionFileListing } from "../../configurationFiles.js";

export interface ListConfigFilesDeps {
  listInstructionFiles: () => InstructionFileListing;
}

export const defaultDeps: ListConfigFilesDeps = {
  listInstructionFiles,
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
      "input fields used by `read_config_file` and `propose_config_update`.",
    {
      _placeholder: z.boolean().optional().describe("Unused parameter (tool takes no input)"),
    },
    async () => {
      const listing = deps.listInstructionFiles();
      return textResult(listing);
    },
  );
}
