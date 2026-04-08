import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import type { IntentStore, ToolCallRecorder } from "../server.js";
import { textResult, errorResult } from "../helpers.js";
import { readInstructionFile } from "../../configurationFiles.js";

const KNOWN_ROLE_DIRS = ["user", "dev", "admin", "owner"];

export interface ProposeConfigUpdateDeps {
  readInstructionFile: (filepath: string) => {
    default_content: string | null;
    custom_content: string | null;
  };
}

export const defaultProposeConfigUpdateDeps: ProposeConfigUpdateDeps = {
  readInstructionFile,
};

export function createProposeConfigUpdateTool(
  _ctx: QueryToolContext,
  intentStore: IntentStore,
  recorder: ToolCallRecorder,
  deps: ProposeConfigUpdateDeps = defaultProposeConfigUpdateDeps,
) {
  return tool(
    "propose_config_update",
    "Propose an update to an instruction file. Use {role}/{filename} format (e.g., 'user/company-context.md', 'dev/changes.md'). " +
      "Validates the path and stages the intent. Returns a ref ID to use in submit_response. " +
      "Default operation is 'append' which adds content to the end of the existing file. Use 'replace' only when rewriting or removing content.",
    {
      file: z
        .string()
        .describe(
          "The instruction file path in {role}/{filename} format (e.g., 'user/identity.md', 'admin/config-updates.md') or {repo}/{filename} for repo-scoped files",
        ),
      content: z
        .string()
        .describe(
          "The content to append (default) or the full replacement content (when operation is 'replace').",
        ),
      operation: z
        .enum(["append", "replace"])
        .default("append")
        .describe(
          "'append' (default) adds content to the end of the existing file. 'replace' overwrites the entire file with the provided content.",
        ),
    },
    async (args) => {
      // Validate the path format
      const parts = args.file.split("/");
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        const errMsg = `Invalid file path "${args.file}". Use {role}/{filename} format (e.g., 'user/identity.md'). Valid role directories: ${KNOWN_ROLE_DIRS.join(", ")}`;
        recorder.record("propose_config_update", args as Record<string, unknown>, {
          error: errMsg,
        });
        return errorResult(errMsg);
      }

      const [dir] = parts;

      // Validate it's a known role directory or repo directory
      // (repo directories are allowed too for repo-scoped instruction files)
      if (!KNOWN_ROLE_DIRS.includes(dir)) {
        // Allow if the first part might be a repo name — we don't validate repo names here
        // since the write will go to configuration/{dir}/{filename} which is safe
      }

      let finalContent: string;
      if (args.operation === "replace") {
        finalContent = args.content;
      } else {
        // Append: read current content and append
        const current = deps.readInstructionFile(args.file);
        const currentContent = current.custom_content ?? current.default_content;
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

      const current = deps.readInstructionFile(args.file);
      const status =
        current.custom_content !== null
          ? "will_overwrite_custom"
          : current.default_content !== null
            ? "will_override_default"
            : "will_create_new";

      const result = { ref, file: args.file, status };
      recorder.record("propose_config_update", args as Record<string, unknown>, result);

      return textResult(result);
    },
  );
}
