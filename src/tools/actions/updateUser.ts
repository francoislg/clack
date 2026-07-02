import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import {
  getUserRecord,
  mergeUserGithub,
  mergeUserOtherNames,
  setUserDisplayName,
} from "../../userRegistry.js";
import { meetsMinimumRole } from "../../permissions.js";
import { errorMessage } from "../../errors.js";

export interface UpdateUserDeps {
  getUserRecord: typeof getUserRecord;
  mergeUserGithub: typeof mergeUserGithub;
  mergeUserOtherNames: typeof mergeUserOtherNames;
  setUserDisplayName: typeof setUserDisplayName;
}

export const defaultUpdateUserDeps: UpdateUserDeps = {
  getUserRecord,
  mergeUserGithub,
  mergeUserOtherNames,
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
      "so a wrong mapping can be corrected by whoever notices. `add_other_names` / `remove_other_names` add or remove " +
      "alternate names / nicknames used as an extra haystack for find_user (e.g. 'Jo' for Jonathan) — also writable by " +
      "ANYONE; names are trimmed and deduplicated case-insensitively. Plugin data is NOT writable here. " +
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
      add_other_names: z
        .array(z.string())
        .optional()
        .describe("Alternate names/nicknames to add to this user. Writable by anyone."),
      remove_other_names: z
        .array(z.string())
        .optional()
        .describe(
          "Alternate names to remove from this user (case-insensitive). Writable by anyone.",
        ),
    },
    async (args) => {
      try {
        const setsDisplayName = args.display_name !== undefined;
        const setsGithub = args.github !== undefined;
        const setsOtherNames =
          args.add_other_names !== undefined || args.remove_other_names !== undefined;

        if (!setsDisplayName && !setsGithub && !setsOtherNames) {
          return errorResult(
            "Nothing to update: provide display_name, github, add_other_names, and/or remove_other_names.",
          );
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
        if (setsOtherNames) {
          await deps.mergeUserOtherNames(args.user_id, {
            add: args.add_other_names,
            remove: args.remove_other_names,
          });
        }

        const record = await deps.getUserRecord(args.user_id);
        return textResult({
          success: true,
          user: {
            user_id: args.user_id,
            display_name: record?.displayName ?? "",
            github: record?.github,
            other_names: record?.otherNames ?? [],
          },
        });
      } catch (error) {
        return errorResult(`Failed to update user: ${errorMessage(error)}`);
      }
    },
  );
}
