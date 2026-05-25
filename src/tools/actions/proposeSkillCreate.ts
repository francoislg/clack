import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import type { IntentStore } from "../server.js";
import { textResult, errorResult } from "../helpers.js";
import { canCreateUserSkill } from "../../permissions.js";
import {
  validateSlug as defaultValidateSlug,
  validateDescription as defaultValidateDescription,
  userSkillExists as defaultUserSkillExists,
} from "../../userSkills.js";

export interface ProposeSkillCreateDeps {
  validateSlug: typeof defaultValidateSlug;
  validateDescription: typeof defaultValidateDescription;
  userSkillExists: typeof defaultUserSkillExists;
}

export const defaultProposeSkillCreateDeps: ProposeSkillCreateDeps = {
  validateSlug: defaultValidateSlug,
  validateDescription: defaultValidateDescription,
  userSkillExists: defaultUserSkillExists,
};

export function createProposeSkillCreateTool(
  ctx: QueryToolContext,
  intentStore: IntentStore,
  deps: ProposeSkillCreateDeps = defaultProposeSkillCreateDeps,
) {
  return tool(
    "propose_skill_create",
    "Propose a new user-created skill (member+). Stages the intent and returns a ref ID to embed in a submit_response action with type 'skill_create'. The skill is NOT created until the user confirms (or until you pair the action with `auto: true`). For 'create a skill that...' requests, set `auto: true` so it applies immediately.",
    {
      name: z
        .string()
        .describe(
          "Slug: lowercase a-z, digits, hyphens. 1-64 chars. No leading/trailing/double hyphens.",
        ),
      description: z
        .string()
        .describe(
          'When-to-use trigger description (1-1024 chars). Shown to Claude in every prompt — this is the ONLY signal Claude has for deciding to load the skill, so write it for high recall. Format: start with the literal phrases a user might say to invoke the skill ("Use when the user asks to <X>, be a <Y>, act as <Z>..."), then list the topic keywords/synonyms that should also fire it ("...or when the conversation involves <topic1>, <topic2>, <topic3>"), then one short clause naming the persona/behavior it activates. Example: "Use when the user asks to be a sports analyst, talk hockey, or break down a game. Also fires on any mention of NHL, playoffs, teams, scores, trades, or sports analysis. Activates the Hockey & Sports Analyst persona." Avoid generic phrasing like "Use this for sports questions" — that under-triggers.',
        ),
      body: z.string().describe("The full SKILL.md body (markdown). Loaded on demand by Claude."),
    },
    async (args) => {
      if (!ctx.config.userSkills?.enabled) {
        return errorResult("User-created skills are not enabled in this installation.");
      }
      if (!canCreateUserSkill(ctx.role)) {
        return errorResult("You do not have permission to create skills.");
      }

      const slugCheck = deps.validateSlug(args.name);
      if (!slugCheck.ok) return errorResult(`Invalid skill name: ${slugCheck.reason}`);

      const descCheck = deps.validateDescription(args.description);
      if (!descCheck.ok) return errorResult(`Invalid description: ${descCheck.reason}`);

      if (deps.userSkillExists(args.name)) {
        return errorResult(
          `A skill named '${args.name}' already exists. Use propose_skill_update to modify it, or choose a different name.`,
        );
      }

      const ref = intentStore.stage({
        type: "skill_create",
        slug: args.name,
        description: args.description.trim(),
        body: args.body,
        ownerUserId: ctx.userId,
      });

      return textResult({
        ref,
        slug: args.name,
        applied: false,
        instruction:
          "STAGED — the skill has NOT been written yet. Embed this ref in a submit_response action of type 'skill_create'. Pair with `auto: true` to apply immediately (recommended for 'create a skill that...' requests where the user just asked for the create). Otherwise the user must click 'Apply'.",
      });
    },
  );
}
