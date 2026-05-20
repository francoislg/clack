import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../tools/helpers.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { requireWritableGame } from "../../core/gamesRegistry.js";
import type { TriviaDataLayer, SubmittedAnswer } from "../../core/types.js";

export function createSubmitAnswersTool(
  data: TriviaDataLayer,
  getGamesFn: GetGamesFn = defaultGetGames,
) {
  return tool(
    "submit_answers",
    `Submit a batch of user answers to a trivia question.

The question's stored \`type\` determines the answer shape required per entry:
- BOOLEAN questions (\`type: "boolean"\` or absent): each entry MUST set \`answer: boolean\` and MUST NOT set \`answerIndex\`. Correctness is computed as \`answer === question.isTrue\`.
- CHOICE questions (\`type: "choice"\`): each entry MUST set \`answerIndex: number\` (in [0, choices.length)) and MUST NOT set \`answer\`. Correctness is computed as \`answerIndex === question.correctIndex\`.

A shape mismatch (boolean entry on a choice question or vice-versa) is rejected with a structured error. Entries that survive validation auto-register the user, stamp the current season tag, deduplicate, and contribute equally to per-user stats (one boolean correct and one choice correct both add 1 to totalCorrect).`,
    {
      game: z
        .string()
        .describe(
          "Game name (must be present in config.trivia.games[] and not disabled). The target question must exist in this game's questions.json.",
        ),
      questionId: z.string().describe("The trivia question ID"),
      messageLink: z.string().describe("Slack permalink to the trivia message"),
      postedAt: z.number().describe("Timestamp when the question was posted to Slack"),
      answers: z
        .array(
          z.object({
            userId: z.string().describe("The user's ID"),
            displayName: z.string().describe("The user's display name"),
            answer: z
              .boolean()
              .optional()
              .describe("Required for boolean questions; must be omitted for choice questions"),
            answerIndex: z
              .number()
              .int()
              .optional()
              .describe(
                "Required for choice questions (0-based index of the chosen reaction); must be omitted for boolean questions",
              ),
          }),
        )
        .describe("Batch of user answers"),
    },
    async (args) => {
      try {
        requireWritableGame(getGamesFn(), args.game);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      const scoped = data.forGame(args.game);

      // Load the question
      const questions = await scoped.loadQuestions();
      const question = questions.find((q) => q.id === args.questionId);
      if (!question) {
        return errorResult(`Question "${args.questionId}" not found.`);
      }

      const answersFormat = question.answersFormat ?? "boolean";

      // Validate every entry's shape matches the question's answers format BEFORE writing anything.
      for (let i = 0; i < args.answers.length; i++) {
        const entry = args.answers[i];
        if (answersFormat === "boolean") {
          if (entry.answer === undefined) {
            return errorResult(
              `Answer entry ${i} (user ${entry.userId}): boolean questions require "answer".`,
            );
          }
          if (entry.answerIndex !== undefined) {
            return errorResult(
              `Answer entry ${i} (user ${entry.userId}): boolean questions must not include "answerIndex".`,
            );
          }
        } else {
          if (entry.answerIndex === undefined) {
            return errorResult(
              `Answer entry ${i} (user ${entry.userId}): choice questions require "answerIndex".`,
            );
          }
          if (entry.answer !== undefined) {
            return errorResult(
              `Answer entry ${i} (user ${entry.userId}): choice questions must not include "answer".`,
            );
          }
          const choicesLength = question.choices?.length ?? 0;
          if (entry.answerIndex < 0 || entry.answerIndex >= choicesLength) {
            return errorResult(
              `Answer entry ${i} (user ${entry.userId}): answerIndex (${entry.answerIndex}) must be in [0, ${choicesLength}).`,
            );
          }
        }
      }

      // Stamp posting metadata on first submission
      if (!question.postedAt) {
        await scoped.updateQuestion(args.questionId, {
          postedAt: args.postedAt,
          messageLink: args.messageLink,
        });
      }

      // Load existing state
      const existingAnswers = await scoped.loadAnswers();
      const users = await data.loadUsers();
      const currentSeason = await scoped.getCurrentSeasonSlug();

      interface AnswerResult {
        userId: string;
        displayName: string;
        correct: boolean;
        skipped: boolean;
        totalCorrect: number;
        totalAnswered: number;
        currentStreak: number;
        currentSeasonCorrect?: number;
        currentSeasonAnswered?: number;
      }
      const results: AnswerResult[] = [];

      for (const answerInput of args.answers) {
        const correct =
          answersFormat === "boolean"
            ? answerInput.answer === question.isTrue
            : answerInput.answerIndex === question.correctIndex;

        // Auto-register or update user (global users.json)
        if (!users.has(answerInput.userId)) {
          await data.saveUser({
            userId: answerInput.userId,
            displayName: answerInput.displayName,
            joinedAt: Date.now(),
          });
          users.set(answerInput.userId, {
            userId: answerInput.userId,
            displayName: answerInput.displayName,
            joinedAt: Date.now(),
          });
        } else {
          const existingUser = users.get(answerInput.userId)!;
          if (existingUser.displayName !== answerInput.displayName) {
            existingUser.displayName = answerInput.displayName;
            await data.saveUser(existingUser);
          }
        }

        // Check for duplicates (per-game)
        const skipped = existingAnswers.some(
          (a) => a.userId === answerInput.userId && a.questionId === args.questionId,
        );

        if (!skipped) {
          const seasonTag = currentSeason !== null ? { season: currentSeason } : {};
          const shape: Pick<SubmittedAnswer, "answer" | "answerIndex"> =
            answersFormat === "boolean"
              ? { answer: answerInput.answer }
              : { answerIndex: answerInput.answerIndex };
          const newAnswer: SubmittedAnswer = {
            userId: answerInput.userId,
            questionId: args.questionId,
            ...shape,
            correct,
            timestamp: Date.now(),
            ...seasonTag,
          };
          await scoped.saveAnswer(newAnswer);
          existingAnswers.push(newAnswer);
        }

        // Compute per-user stats over this game's answers only
        const userAnswers = existingAnswers
          .filter((a) => a.userId === answerInput.userId)
          .sort((a, b) => a.timestamp - b.timestamp);
        const totalCorrect = userAnswers.filter((a) => a.correct).length;
        const totalAnswered = userAnswers.length;

        let currentStreak = 0;
        for (let i = userAnswers.length - 1; i >= 0; i--) {
          if (userAnswers[i].correct) currentStreak++;
          else break;
        }

        const result: AnswerResult = {
          userId: answerInput.userId,
          displayName: answerInput.displayName,
          correct,
          skipped,
          totalCorrect,
          totalAnswered,
          currentStreak,
        };
        if (currentSeason !== null) {
          const currentSeasonAnswers = userAnswers.filter((a) => a.season === currentSeason);
          result.currentSeasonCorrect = currentSeasonAnswers.filter((a) => a.correct).length;
          result.currentSeasonAnswered = currentSeasonAnswers.length;
        }
        results.push(result);
      }

      return textResult({
        results,
        questionId: args.questionId,
      });
    },
  );
}
