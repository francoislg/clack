import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../helpers.js";
import { errorMessage } from "../../errors.js";
import type { EmojiCache } from "../../slack/emojiCache.js";
import { upsertLore, MAX_LORE_EXAMPLES, type EmojiLoreEntry } from "../../emojiLore.js";

export interface DescribeEmojiDeps {
  upsertLore: typeof upsertLore;
}

export const defaultDescribeEmojiDeps: DescribeEmojiDeps = { upsertLore };

const exampleArg = z.object({
  text: z
    .string()
    .describe(
      "A PARAPHRASE of a situation this emoji was used in — never a verbatim quote, and never name the person who used it. Describe the kind of moment, not the people.",
    ),
  link: z
    .string()
    .optional()
    .describe("Slack permalink to the source message, when this came from something you observed"),
});

export interface DescribeEmojiResult {
  ok: boolean;
  name: string;
  entry?: EmojiLoreEntry;
  warning?: string;
  conflict?: string;
  existing?: EmojiLoreEntry;
}

export function createDescribeEmojiTool(
  emojiCache: EmojiCache,
  deps: DescribeEmojiDeps = defaultDescribeEmojiDeps,
) {
  return tool(
    "describe_emoji",
    "Record what a custom workspace emoji MEANS here — the cultural knowledge its name doesn't carry (an in-joke, a team ritual, a specific situation it marks). Lore saved with this tool is what `find_emoji` searches, so recording it is what lets you pick the right emoji later. Use source 'taught' when a person told you the meaning, 'observed' when you inferred it from how you saw it used. An observed write never overwrites a taught one — if they disagree, you get the taught entry back and should raise the discrepancy rather than silently correcting it.",
    {
      name: z.string().describe("Emoji name without colons (e.g. 'partyparrot')"),
      meaning: z
        .string()
        .describe("What it means / when this workspace uses it — one or two sentences"),
      tags: z
        .array(z.string())
        .optional()
        .describe(
          "Short intent hooks someone might search by ('approval', 'incident', 'celebration'). Generous tagging is what makes the emoji findable by purpose.",
        ),
      examples: z
        .array(exampleArg)
        .max(MAX_LORE_EXAMPLES)
        .optional()
        .describe(
          `Up to ${MAX_LORE_EXAMPLES} paraphrased illustrations of its use, each optionally with a permalink`,
        ),
      source: z
        .enum(["taught", "observed"])
        .describe("'taught' when a person stated this meaning; 'observed' when you inferred it"),
    },
    async (args) => {
      try {
        const result = await deps.upsertLore({
          name: args.name,
          meaning: args.meaning,
          tags: args.tags,
          examples: args.examples,
          source: args.source,
        });

        if (!result.applied) {
          const payload: DescribeEmojiResult = {
            ok: false,
            name: result.existing.name,
            conflict:
              "This emoji already has lore a person taught, and an observed guess does not overwrite it. " +
              "If what you saw genuinely contradicts the stored meaning, surface the discrepancy to the user " +
              "instead of rewriting it — they can confirm with source: 'taught'.",
            existing: result.existing,
          };
          return textResult(payload);
        }

        const payload: DescribeEmojiResult = { ok: true, name: result.entry.name };
        // Saved regardless: the emoji list is cached for up to an hour, so lore taught right after
        // an upload would be wrongly rejected if an unknown name were fatal.
        if (!(await emojiCache.has(result.entry.name))) {
          payload.warning =
            `No custom emoji named '${result.entry.name}' is in the workspace emoji list. ` +
            `The lore was saved anyway (the list is cached and may be up to an hour stale), but ` +
            `double-check the spelling if you expected it to exist.`;
        }
        return textResult(payload);
      } catch (error) {
        return errorResult(`Failed to save emoji lore: ${errorMessage(error)}`);
      }
    },
  );
}
