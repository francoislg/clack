import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../plugins-sdk/sdk.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { requireWritableGame } from "../../core/gamesRegistry.js";
import { repaintHint } from "../../core/refreshHint.js";
import { TRIVIA_POINTS_MAX } from "../../core/configTypes.js";
import type {
  TriviaDataLayer,
  TriviaQuestion,
  QuestionOverrideOriginals,
} from "../../core/types.js";
import type { ClackSdk } from "../../../../plugins-sdk/sdk.js";
import { rewriteWorthBlock } from "./renderPoints.js";

const DESCRIPTION = `Hand-correct a stamped value on ONE trivia question that nothing else can re-derive. Admin-only. Works on staged, live, and already-revealed questions.

Patchable fields (pass at least one; omitted fields are left alone):
- \`points\`: what the question is worth, 1–10. Every scoring surface re-prices on the next \`compute_answers\`/\`retrieve_scores\` — answer rows are untouched, so verdicts, cheat flags, and overrides all survive. Bounded by the ABSOLUTE 1–10, NOT by the game's configured \`points.max\`: that cap governs what Claude may pick at generation, and must never retroactively lock a question that was already posed. Setting 1 makes it an ordinary question again.
- \`difficulty\`: the 1–10 self-rating. Audit metadata only — no scoring, card, or hint effect.

The FIRST override of a field captures its original value (surfaced as \`originals\`), so the generation-time fact is never lost, even across repeated overrides.

Not this tool's job:
- A wrong ANSWER KEY → \`settle_question\` (then compute_answers reprocess + refresh_question_cards).
- ONE player's wrong verdict → \`override_answer\`.
- A question that shouldn't count at all → \`settle_question\` with \`invalidate: true\`.
- The statement, answer format, category, season, or slot are NOT patchable by design — players answered THAT question in THAT shape, and rewriting it would falsify the record rather than correct it. \`suggestedDifficulty\` is likewise fixed: it records what the server ROLLED at generation.

A \`points\` change on a POSTED question rewrites the "Worth N points" line on the stored card and returns a \`refreshHint\` — call exactly that to repaint. A \`difficulty\`-only change touches no card and returns no hint.`;

export function createOverrideQuestionTool(
  data: TriviaDataLayer,
  sdk: Pick<ClackSdk, "t">,
  getGamesFn: GetGamesFn = defaultGetGames,
) {
  return tool(
    "override_question",
    DESCRIPTION,
    {
      game: z
        .string()
        .describe(
          "Game name (must be present in config.trivia.games[] and not disabled). The question is looked up in this game's directory only.",
        ),
      questionId: z.string().describe("ID of the trivia question to correct"),
      points: z
        .number()
        .int()
        .min(1)
        .max(TRIVIA_POINTS_MAX)
        .optional()
        .describe(
          `What the question is worth, an integer in [1, ${TRIVIA_POINTS_MAX}]. Not bounded by the game's configured points.max. 1 restores ordinary scoring.`,
        ),
      difficulty: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("The 1–10 difficulty self-rating. Audit metadata; affects nothing else."),
    },
    async (args) => {
      try {
        requireWritableGame(getGamesFn(), args.game);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      if (args.points === undefined && args.difficulty === undefined) {
        return errorResult("Nothing to override — pass at least one of `points` or `difficulty`.");
      }

      const scoped = data.forGame(args.game);
      const question = (await scoped.loadQuestions()).find((q) => q.id === args.questionId);
      if (!question) {
        return errorResult(`Question "${args.questionId}" not found.`);
      }

      // Capture each field's pre-override value ONCE so repeated overrides never lose
      // the generation-time fact. An originally-unset field is recorded as its semantic
      // original (points → 1, difficulty → null) rather than `undefined`, which
      // JSON.stringify would drop — making the next override re-capture the CURRENT
      // value and quietly rewrite history. See QuestionOverrideOriginals.
      const originals: QuestionOverrideOriginals = { ...question.overriddenFrom };
      const patch: Partial<TriviaQuestion> = {};

      if (args.points !== undefined) {
        if (originals.points === undefined) originals.points = question.points ?? 1;
        // 1 is stored as absence, matching save_question's stamping rule.
        patch.points = args.points > 1 ? args.points : undefined;
      }
      if (args.difficulty !== undefined) {
        if (originals.difficulty === undefined) originals.difficulty = question.difficulty ?? null;
        patch.difficulty = args.difficulty;
      }

      const pointsChanged = args.points !== undefined && patch.points !== question.points;
      if (pointsChanged && question.postedBlocks !== undefined) {
        patch.postedBlocks = rewriteWorthBlock(question.postedBlocks, patch.points ?? 1, sdk);
      }

      await scoped.updateQuestion(question.id, { ...patch, overriddenFrom: originals });

      const needsRepaint = pointsChanged && question.postedBlocks !== undefined;
      return textResult({
        action: "overridden",
        game: args.game,
        questionId: question.id,
        ...(args.points !== undefined ? { points: patch.points ?? 1 } : {}),
        ...(args.difficulty !== undefined ? { difficulty: patch.difficulty } : {}),
        originals,
        ...(needsRepaint ? { refreshHint: repaintHint(question.id) } : {}),
      });
    },
  );
}
