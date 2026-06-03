import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import type { IntentStore } from "../server.js";
import { textResult, errorResult } from "../helpers.js";
import { readInstructionFile, getConfiguredRepoNames } from "../../configurationFiles.js";
import {
  CONFIG_TARGET_FIELDS,
  validateConfigTarget,
  buildConfigPath,
  type ConfigTargetArgs,
} from "../query/configFieldSchemas.js";

export interface ProposeConfigUpdateDeps {
  readInstructionFile: (filepath: string) => {
    default_content: string | null;
    custom_content: string | null;
  };
  getConfiguredRepoNames: () => string[];
}

export const defaultProposeConfigUpdateDeps: ProposeConfigUpdateDeps = {
  readInstructionFile,
  getConfiguredRepoNames,
};

export function createProposeConfigUpdateTool(
  _ctx: QueryToolContext,
  intentStore: IntentStore,
  deps: ProposeConfigUpdateDeps = defaultProposeConfigUpdateDeps,
) {
  return tool(
    "propose_config_update",
    "Propose an update to an instruction file. For role baseline files, pass `role` and `file`; " +
      "for topic-scoped instructions, also pass `topic`. For per-repo instruction files, pass " +
      "`repo` and `file` instead. Validates the path and stages the intent. " +
      "Returns a ref ID to use in submit_response. Default operation is 'append' which adds content " +
      "to the end of the existing file. Use 'replace' to rewrite the file. Use 'delete' to remove " +
      "a custom override — the file reverts to the shipped default if one exists, otherwise the " +
      "file is deleted entirely. `content` must be omitted when operation is 'delete'.",
    {
      ...CONFIG_TARGET_FIELDS,
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
    async (rawArgs) => {
      const args = rawArgs as ConfigTargetArgs & {
        content?: string;
        operation: "append" | "replace" | "delete";
      };

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
