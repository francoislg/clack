import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { errorResult } from "../helpers.js";
import { discoverUserSkills as defaultDiscoverUserSkills } from "../../userSkills.js";

export interface ListUserSkillsDeps {
  discoverUserSkills: typeof defaultDiscoverUserSkills;
}

export const defaultListUserSkillsDeps: ListUserSkillsDeps = {
  discoverUserSkills: defaultDiscoverUserSkills,
};

export function createListUserSkillsTool(
  ctx: QueryToolContext,
  deps: ListUserSkillsDeps = defaultListUserSkillsDeps,
) {
  return tool(
    "list_user_skills",
    "List all user-created skills with their owner. Optional `owner` filter narrows to a specific Slack user ID. Triggers are visible inline in the AVAILABLE SKILL PACKS catalog already — use this tool when you need ownership info or to see disabled skills too.",
    {
      owner: z
        .string()
        .optional()
        .describe(
          "Optional Slack user ID to filter by (e.g., 'U123ABC'). Omit to list all skills.",
        ),
    },
    async (args) => {
      if (!ctx.config.userSkills?.enabled) {
        return errorResult("User-created skills are not enabled in this installation.");
      }

      const all = deps.discoverUserSkills();
      const filtered = args.owner ? all.filter((s) => s.ownerUserId === args.owner) : all;

      if (filtered.length === 0) {
        const msg = args.owner
          ? `No user skills found owned by <@${args.owner}>.`
          : "No user skills found.";
        return { content: [{ type: "text" as const, text: msg }] };
      }

      const sorted = [...filtered].sort((a, b) => a.slug.localeCompare(b.slug));
      const lines = [
        `User skills (${sorted.length} total):`,
        ...sorted.map((s) => {
          const badge = s.disabledAt ? " (disabled)" : "";
          return `- ${s.slug} — ${s.description} — owner: <@${s.ownerUserId}>${badge}`;
        }),
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );
}
