import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../tools/helpers.js";
import type { TriviaDataLayer } from "./types.js";

export function createSubmitAnswersTool(data: TriviaDataLayer) {
  return tool(
    "submit_answers",
    "Submit a batch of user answers to a trivia question. Handles auto-registration and returns per-user results with updated stats.",
    {
      questionId: z.string().describe("The trivia question ID"),
      messageLink: z.string().describe("Slack permalink to the trivia message"),
      postedAt: z.number().describe("Timestamp when the question was posted to Slack"),
      answers: z
        .array(
          z.object({
            userId: z.string().describe("The user's ID"),
            displayName: z.string().describe("The user's display name"),
            answer: z.boolean().describe("The user's answer — true or false"),
          }),
        )
        .describe("Batch of user answers"),
    },
    async (args) => {
      // Load the question
      const questions = await data.loadQuestions();
      const question = questions.find((q) => q.id === args.questionId);
      if (!question) {
        return errorResult(`Question "${args.questionId}" not found.`);
      }

      // Stamp posting metadata on first submission
      if (!question.postedAt) {
        await data.updateQuestion(args.questionId, {
          postedAt: args.postedAt,
          messageLink: args.messageLink,
        });
      }

      // Load existing state
      const existingAnswers = await data.loadAnswers();
      const users = await data.loadUsers();

      // Process each answer
      const results: Array<{
        userId: string;
        displayName: string;
        correct: boolean;
        skipped: boolean;
        totalCorrect: number;
        totalAnswered: number;
        currentStreak: number;
      }> = [];

      for (const answerInput of args.answers) {
        const correct = answerInput.answer === question.isTrue;

        // Auto-register or update user
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

        // Check for duplicates
        const skipped = existingAnswers.some(
          (a) => a.userId === answerInput.userId && a.questionId === args.questionId,
        );

        if (!skipped) {
          await data.saveAnswer({
            userId: answerInput.userId,
            questionId: args.questionId,
            answer: answerInput.answer,
            correct,
            timestamp: Date.now(),
          });

          existingAnswers.push({
            userId: answerInput.userId,
            questionId: args.questionId,
            answer: answerInput.answer,
            correct,
            timestamp: Date.now(),
          });
        }

        // Compute per-user stats
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

        results.push({
          userId: answerInput.userId,
          displayName: answerInput.displayName,
          correct,
          skipped,
          totalCorrect,
          totalAnswered,
          currentStreak,
        });
      }

      return textResult({
        results,
        questionId: args.questionId,
      });
    },
  );
}
