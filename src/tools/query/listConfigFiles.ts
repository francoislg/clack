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
    "List all instruction/configuration files grouped by role directory. Shows which files have custom overrides and which use defaults.",
    {
      // Claude Agent SDK requires at least one schema property
      _placeholder: z.boolean().optional().describe("Unused parameter (tool takes no input)"),
    },
    async () => {
      const listing = deps.listInstructionFiles();

      const result: Record<string, unknown> = {};

      // Role-based instruction files
      for (const roleListing of listing.roles) {
        result[roleListing.role] = roleListing.files.map((f) => ({
          file: f.filename,
          status: f.source,
        }));
      }

      // Repo-scoped instruction files
      if (listing.repos.length > 0) {
        result.repos = listing.repos.map((f) => ({
          filename: f.filename,
          status: f.hasOverride ? "customized" : f.hasDefault ? "default" : "not_created",
        }));
      }

      return textResult(result);
    },
  );
}
