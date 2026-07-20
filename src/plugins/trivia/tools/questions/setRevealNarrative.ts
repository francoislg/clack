import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { KnownBlock } from "@slack/types";
import { BlockSchema } from "../../../../plugins-sdk/sdk.js";
import { textResult, errorResult } from "../../../../plugins-sdk/sdk.js";
import {
  defaultGetGames,
  defaultGetTriviaConfig,
  type GetGamesFn,
  type GetTriviaConfigFn,
} from "../../core/configBridge.js";
import { requireWritableGame } from "../../core/gamesRegistry.js";
import { resolveIncludeRevealInQuestions } from "../../domain/includeRevealInQuestions.js";
import type { TriviaDataLayer } from "../../core/types.js";

const DESCRIPTION = `Persist Claude-authored reveal NARRATIVE blocks onto a trivia question's record (\`games/<game>/questions.json\`). This is a pure JSON write — NO Slack message is edited (\`refresh_question_cards\` remains the sole card editor, and it appends these blocks below the deterministic results footer at projection time). Re-calling is idempotent: it REPLACES the stored \`revealBlocks\`, never appends.

\`revealBlocks\` SHALL carry ONLY narrative (the verdict prose, the WHY explanation, the fun-fact comment, and the expanded "nobody cracked it" teaching when nobody got it right) — NEVER the deterministic Answer/Correct/Incorrect facts, which \`refresh_question_cards\` always renders from \`answers.json\`.

This tool is rejected (writes nothing) when the game's resolved \`includeRevealInQuestions\` is \`"no"\` — in that mode cards stay facts-only and narrative lives in the summary. Call it only on the reveal's \`"yes"\` branch, once per revealed question, BEFORE \`refresh_question_cards\`.`;

export function createSetRevealNarrativeTool(
  data: TriviaDataLayer,
  getGamesFn: GetGamesFn = defaultGetGames,
  getTriviaConfigFn: GetTriviaConfigFn = defaultGetTriviaConfig,
) {
  return tool(
    "set_reveal_narrative",
    DESCRIPTION,
    {
      game: z
        .string()
        .describe("Game name (must be present in config.trivia.games[] and not disabled)."),
      questionId: z
        .string()
        .describe("The trivia question ID whose card narrative is being authored."),
      revealBlocks: z
        .array(BlockSchema)
        .min(1)
        .describe(
          "The Block Kit narrative payload for this question's revealed card — verdict prose, the WHY, the fun-fact comment, the 'nobody cracked it' teaching. Narrative ONLY; never the Answer/Correct/Incorrect facts (those render deterministically from answers.json).",
        ),
    },
    async (args) => {
      try {
        requireWritableGame(getGamesFn(), args.game);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      const gameEntry = getGamesFn().find((g) => g.name === args.game) ?? null;
      const resolved = resolveIncludeRevealInQuestions(gameEntry, getTriviaConfigFn());
      if (resolved === "no") {
        return errorResult(
          `set_reveal_narrative is rejected: game "${args.game}" resolves includeRevealInQuestions: "no", so cards stay facts-only and carry no authored narrative. Nothing was written.`,
        );
      }

      const scoped = data.forGame(args.game);
      const questions = await scoped.loadQuestions();
      const question = questions.find((q) => q.id === args.questionId);
      if (question === undefined) {
        return errorResult(`Question "${args.questionId}" not found in game "${args.game}".`);
      }

      await scoped.updateQuestion(args.questionId, {
        revealBlocks: args.revealBlocks as KnownBlock[],
      });

      return textResult({
        game: args.game,
        questionId: args.questionId,
        updated: true,
        blockCount: args.revealBlocks.length,
      });
    },
  );
}
