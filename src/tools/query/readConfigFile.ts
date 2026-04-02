import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { readInstructionFile } from "../../configurationFiles.js";
import { resolveInstructions, buildRoleChain } from "../../cascadingConfigResolver.js";
import type { UserRole } from "../../roles.js";

const VALID_ROLES = ["member", "dev", "admin", "owner"] as const;

export function createReadConfigFileTool(_ctx: QueryToolContext) {
  return tool(
    "read_config_file",
    "Read an instruction file. Returns both default and custom content for comparison. " +
      "Use {role}/{filename} format (e.g., 'user/identity.md', 'dev/changes.md'). " +
      "Alternatively, pass just a role name (e.g., 'dev') to get the full resolved instruction set for that role.",
    {
      file: z
        .string()
        .describe(
          "The instruction file path (e.g., 'user/identity.md') or a role name (e.g., 'dev') for resolved view",
        ),
      changesWorkflowEnabled: z
        .boolean()
        .optional()
        .default(true)
        .describe("Whether changesWorkflow is enabled (used for resolved view)"),
    },
    async (args) => {
      // Check if this is a resolved view request (just a role name)
      if (VALID_ROLES.includes(args.file as (typeof VALID_ROLES)[number])) {
        const roleChain = buildRoleChain(args.file as UserRole, args.changesWorkflowEnabled);
        const resolved = resolveInstructions(roleChain);
        return textResult({
          view: "resolved",
          role: args.file,
          roleChain,
          content: resolved,
        });
      }

      // Otherwise, read a specific file
      const result = readInstructionFile(args.file);

      if (result.default_content === null && result.custom_content === null) {
        return errorResult(
          `File "${args.file}" not found. Use {role}/{filename} format (e.g., 'user/identity.md').`,
        );
      }

      return textResult({
        file: args.file,
        default_content: result.default_content,
        custom_content: result.custom_content,
      });
    },
  );
}
