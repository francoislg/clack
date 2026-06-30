import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { getUserRecord, mergeUserGithub, setUserDisplayName } from "../../userRegistry.js";
import { meetsMinimumRole } from "../../permissions.js";
import { errorMessage } from "../../errors.js";

export interface UpdateUserDeps {
  getUserRecord: typeof getUserRecord;
  mergeUserGithub: typeof mergeUserGithub;
  setUserDisplayName: typeof setUserDisplayName;
}

export const defaultUpdateUserDeps: UpdateUserDeps = {
  getUserRecord,
  mergeUserGithub,
  setUserDisplayName,
};

export function createUpdateUserTool(
  ctx: QueryToolContext,
  deps: UpdateUserDeps = defaultUpdateUserDeps,
) {
  return tool(
    "update_user",
    "Update fields on a Slack user's record. Omit a field to keep it; pass null to clear it. " +
      "`display_name` overrides the auto-resolved Slack name — writable only by that user themselves or an admin. " +
      "`github.username` maps the Slack user to a GitHub login (used for PR reviewer assignment) — writable by ANYONE, " +
      "so a wrong mapping can be corrected by whoever notices. Plugin data is NOT writable here. " +
      "If any field in the call is unauthorized, the whole call is rejected and nothing is changed.",
    {
      user_id: z.string().describe("Slack user ID of the record to update"),
      display_name: z
        .string()
        .nullable()
        .optional()
        .describe("Set the display-name override, or null to clear it. Self or admin only."),
      github: z
        .object({ username: z.string().min(1) })
        .nullable()
        .optional()
        .describe("Set the GitHub username mapping, or null to clear it. Writable by anyone."),
    },
    async (args) => {
      try {
        const setsDisplayName = args.display_name !== undefined;
        const setsGithub = args.github !== undefined;

        if (!setsDisplayName && !setsGithub) {
          return errorResult("Nothing to update: provide display_name and/or github.");
        }

        // Permission gate is evaluated BEFORE any write so a rejection leaves the record
        // untouched (atomic): display_name is self-or-admin; github is open to anyone.
        if (setsDisplayName) {
          const isSelf = ctx.userId === args.user_id;
          const isAdmin = meetsMinimumRole(ctx.role, "admin");
          if (!isSelf && !isAdmin) {
            return errorResult(
              "Permission denied for field 'display_name': only the user themselves or an admin can change another user's display name. No changes were applied.",
            );
          }
        }

        if (setsDisplayName) {
          if (args.display_name === null) {
            // Clearing the override falls back to the empty placeholder; the next Slack
            // resolution repopulates it.
            await deps.setUserDisplayName(args.user_id, "");
          } else {
            await deps.setUserDisplayName(args.user_id, args.display_name as string);
          }
        }
        if (setsGithub) {
          await deps.mergeUserGithub(args.user_id, args.github ?? null);
        }

        const record = await deps.getUserRecord(args.user_id);
        return textResult({
          success: true,
          user: {
            user_id: args.user_id,
            display_name: record?.displayName ?? "",
            github: record?.github,
          },
        });
      } catch (error) {
        return errorResult(`Failed to update user: ${errorMessage(error)}`);
      }
    },
  );
}
