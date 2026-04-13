import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../tools/helpers.js";
import type { TriviaDataLayer } from "./types.js";

export function createSubmitAnswerTool(data: TriviaDataLayer) {
  return tool(
    "submit_answer",
    "Submit a user's answer to a trivia question. Returns whether the answer was correct and the user's updated score.",
    {
      userId: z.string().describe("The user's ID"),
      questionId: z.string().describe("The trivia question ID"),
      answer: z.boolean().describe("The user's answer — true or false"),
    },
    async (args) => {
      const users = await data.loadUsers();
      if (!users.has(args.userId)) {
        return errorResult(`User "${args.userId}" is not registered. Call register_user first.`);
      }

      const questions = await data.loadQuestions();
      const question = questions.find((q) => q.id === args.questionId);
      if (!question) {
        return errorResult(`Question "${args.questionId}" not found.`);
      }

      const allAnswers = await data.loadAnswers();
      const alreadyAnswered = allAnswers.some(
        (a) => a.userId === args.userId && a.questionId === args.questionId,
      );
      if (alreadyAnswered) {
        return errorResult("This user has already answered this question.");
      }

      const correct = args.answer === question.isTrue;

      await data.saveAnswer({
        userId: args.userId,
        questionId: args.questionId,
        answer: args.answer,
        correct,
        timestamp: Date.now(),
      });

      // Compute updated stats for this user
      const userAnswers = [...allAnswers.filter((a) => a.userId === args.userId), { correct }];
      const totalCorrect = userAnswers.filter((a) => a.correct).length;
      const totalAnswered = userAnswers.length;

      // Compute current streak (consecutive correct answers from the end)
      const userAnswersSorted = allAnswers
        .filter((a) => a.userId === args.userId)
        .sort((a, b) => a.timestamp - b.timestamp);
      userAnswersSorted.push({ correct } as (typeof userAnswersSorted)[0]);

      let currentStreak = 0;
      for (let i = userAnswersSorted.length - 1; i >= 0; i--) {
        if (userAnswersSorted[i].correct) {
          currentStreak++;
        } else {
          break;
        }
      }

      return textResult({
        correct,
        correctAnswer: question.isTrue,
        currentStreak,
        totalCorrect,
        totalAnswered,
      });
    },
  );
}
