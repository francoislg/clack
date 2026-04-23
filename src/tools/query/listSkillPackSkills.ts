import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { errorResult } from "../helpers.js";

/**
 * `list_skill_pack_skills({ pack })` — browse the skill catalog inside a lazy
 * skill pack. Returns a plain-text bulleted list, one line per skill. The tool
 * delegates every lookup to `SkillsManager`; it holds no filesystem or registry
 * logic of its own.
 *
 * Rejects unknown packs and eager (non-lazy) packs — for the latter, Claude
 * should use the native `Skill(...)` tool instead, since the pack is already
 * loaded via `--plugin-dir`.
 */
export function createListSkillPackSkillsTool(ctx: QueryToolContext) {
  return tool(
    "list_skill_pack_skills",
    "List every skill available in a lazy-loaded skill pack. Call this after spotting a pack in the AVAILABLE SKILL PACKS catalog and before load_skill, so you pick the right skill.",
    {
      pack: z.string().describe("The skill pack name from the AVAILABLE SKILL PACKS catalog."),
    },
    async (args) => {
      const manager = ctx.skillsManager;
      if (!manager) {
        return errorResult(
          "list_skill_pack_skills is not available in this session. This is a bug — contact the operator.",
        );
      }

      if (manager.isEagerPack(args.pack)) {
        return errorResult(
          `Pack '${args.pack}' is eager-loaded — its skills are already available via the native Skill() tool. Call Skill("<name>") directly instead of list_skill_pack_skills.`,
        );
      }

      if (!manager.knowsLazyPack(args.pack)) {
        const available = manager.knownLazyPackNames().join(", ") || "(none)";
        return errorResult(
          `Unknown skill pack: '${args.pack}'. Available lazy packs: ${available}.`,
        );
      }

      const skills = manager.listSkills(args.pack) ?? [];
      if (skills.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Pack '${args.pack}' has no skills available.`,
            },
          ],
        };
      }

      const lines = [
        `Skills in '${args.pack}' (call load_skill("${args.pack}", "<skill>") to apply one):`,
        ...skills.map((s) => `- ${s.name} — ${s.description}`),
      ];
      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );
}
