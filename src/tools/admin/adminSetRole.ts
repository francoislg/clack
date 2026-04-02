import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../helpers.js";
import { setRole } from "../../roles.js";

export function createAdminSetRoleTool() {
  return tool(
    "admin_set_role",
    "Set a user's role. Cascades automatically: promoting to admin removes from devs, demoting to member removes from both. Use find_user first to resolve display names to Slack user IDs.",
    {
      user: z.string().describe("Slack user ID (e.g., 'U0123ABCDEF')"),
      role: z
        .enum(["admin", "dev", "member"])
        .describe(
          "Target role. 'admin' promotes, 'dev' sets to dev, 'member' removes all elevated roles.",
        ),
    },
    async ({ user, role }) => {
      const result = await setRole(user, role);

      if (!result.success) {
        return textResult({ error: result.error, user, role });
      }

      return textResult({ success: true, user, role, message: `User role set to ${role}.` });
    },
  );
}
