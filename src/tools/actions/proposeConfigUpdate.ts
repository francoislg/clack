import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import type { IntentStore } from "../server.js";
import { textResult, errorResult } from "../helpers.js";
import { readInstructionFile } from "../../configurationFiles.js";
import {
  ROLE_ENUM,
  TOPIC_PATTERN,
  FILE_PATTERN,
  buildInstructionPath,
} from "../query/configFieldSchemas.js";

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
  deps: ProposeConfigUpdateDeps = defaultProposeConfigUpdateDeps,
) {
  return tool(
    "propose_config_update",
    "Propose an update to an instruction file. For baseline files, pass `role` and `file`. " +
      "For topic-scoped instructions, also pass `topic`. Validates the path and stages the intent. " +
      "Returns a ref ID to use in submit_response. Default operation is 'append' which adds content " +
      "to the end of the existing file. Use 'replace' to rewrite the file. Use 'delete' to remove " +
      "a custom override — the file reverts to the shipped default if one exists, otherwise the " +
      "file is deleted entirely. `content` must be omitted when operation is 'delete'.",
    {
      role: ROLE_ENUM.describe("The role directory (one of: user, dev, admin, owner)"),
      topic: TOPIC_PATTERN.optional().describe(
        "Optional topic name for topic-scoped instruction files (e.g., 'metabase'). Omit for baseline files.",
      ),
      file: FILE_PATTERN.describe(
        "The bare filename ending in `.md` (e.g., 'identity.md'). No slashes — use the `topic` field for topic-scoped paths.",
      ),
      content: z
        .string()
        .optional()
        .describe(
          "Required for 'append' and 'replace'. Forbidden (must be omitted) when operation is 'delete'.",
        ),
      operation: z
        .enum(["append", "replace", "delete"])
        .default("append")
        .describe(
          "'append' (default) adds content to the end of the existing file. 'replace' overwrites the entire file. 'delete' removes the custom override (reverts to shipped default if one exists, otherwise deletes the file).",
        ),
    },
    async (args) => {
      const path = buildInstructionPath(args.role, args.topic, args.file);

      if (args.operation === "delete") {
        if (args.content !== undefined && args.content !== "") {
          return errorResult(
            "`content` must be omitted when operation is 'delete'. To replace file contents, use operation 'replace' instead.",
          );
        }

        const current = deps.readInstructionFile(path);
        if (current.custom_content === null) {
          return errorResult(
            `No custom override exists at \`${path}\` — nothing to delete. The file ${current.default_content !== null ? "uses the shipped default already" : "does not exist at any tier"}.`,
          );
        }

        const ref = intentStore.stage({
          type: "config_update",
          operation: "delete",
          file: path,
        });

        const status =
          current.default_content !== null ? "will_revert_to_default" : "will_delete_custom_only";

        return textResult({
          ref,
          file: path,
          status,
          applied: false,
          instruction:
            "STAGED — the override has NOT been removed yet. Unless you also set `auto: true` on the matching `config_update` action in submit_response, the user must click the action button to actually remove the override. Your submit_response prose MUST reflect this: use pending language ('Ready to remove your override…', 'Click below to remove this customization'). Do NOT use 'Done', 'I've removed…', 'The override is gone' — those imply the change is live, which it isn't until the click.",
        });
      }

      // append / replace
      if (args.content === undefined) {
        return errorResult("`content` is required when operation is 'append' or 'replace'.");
      }

      let finalContent: string;
      if (args.operation === "replace") {
        finalContent = args.content;
      } else {
        const current = deps.readInstructionFile(path);
        const currentContent = current.custom_content ?? current.default_content;
        if (currentContent) {
          finalContent = currentContent.trimEnd() + "\n\n" + args.content;
        } else {
          finalContent = args.content;
        }
      }

      const ref = intentStore.stage({
        type: "config_update",
        operation: "write",
        file: path,
        content: finalContent,
      });

      const current = deps.readInstructionFile(path);
      const status =
        current.custom_content !== null
          ? "will_overwrite_custom"
          : current.default_content !== null
            ? "will_override_default"
            : "will_create_new";

      return textResult({
        ref,
        file: path,
        status,
        applied: false,
        instruction:
          "STAGED — the file has NOT been written yet. Unless you also set `auto: true` on the matching `config_update` action in submit_response, the user must click 'Apply Update' to actually write the file. Your submit_response prose MUST reflect this: use pending language ('I've drafted...', 'Ready for you to apply...', 'Click below to save this preference'). Do NOT use 'Done', 'I'll now...', 'I've added...' — those imply the change is live, which it isn't until the click.",
      });
    },
  );
}
