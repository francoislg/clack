import type { ClackSdk, ClackPlugin } from "../sdk.js";
import { createSdkDataLayer } from "./data.js";
import { SEED_CATEGORIES } from "./seedCategories.js";
import { createAddCategoriesTool } from "./addCategories.js";
import { createRemoveCategoriesTool } from "./removeCategories.js";
import { createGetIdeasTool } from "./getIdeas.js";
import { createSaveQuestionTool } from "./saveQuestion.js";
import { createFindPreviousQuestionsTool } from "./findPreviousQuestions.js";
import { createSubmitAnswersTool } from "./submitAnswers.js";
import { createRetrieveScoresTool } from "./retrieveScores.js";
import { createSaveCheatingTool } from "./saveCheating.js";
import { createSendQuestionsInstructionsTool } from "./sendQuestionsInstructions.js";
import { createProcessResponsesInstructionsTool } from "./processResponsesInstructions.js";
import { createCreateSchedulesInstructionsTool } from "./createSchedulesInstructions.js";
import { TRIVIA_CHECK_INSTRUCTION } from "./triviaCheckInstruction.js";

export const triviaPlugin: ClackPlugin = async (sdk: ClackSdk) => {
  const data = createSdkDataLayer(sdk);

  // Seed categories on first load
  const categories = await data.loadCategories();
  if (categories.length === 0) {
    await data.saveCategories(SEED_CATEGORIES);
  }

  sdk.addInstruction("user", "trivia-check", TRIVIA_CHECK_INSTRUCTION);

  sdk.registerTool("owner", createAddCategoriesTool(data), "Adding trivia categories");
  sdk.registerTool("owner", createRemoveCategoriesTool(data), "Removing trivia categories");
  sdk.registerTool("owner", createGetIdeasTool(data), "Getting trivia category ideas");
  sdk.registerTool("owner", createSaveQuestionTool(data), "Saving trivia question — {category}");
  sdk.registerTool(
    "member",
    createFindPreviousQuestionsTool(data),
    "Searching past trivia questions",
  );
  sdk.registerTool("owner", createSubmitAnswersTool(data), "Submitting trivia answers");
  sdk.registerTool("member", createRetrieveScoresTool(data), "Retrieving trivia scores");

  // Hidden from Slack task cards — the recorded user must not see this fire.
  sdk.registerTool("member", createSaveCheatingTool(data), {
    label: "Reviewing response",
    hidden: true,
  });

  // Instruction tools — called on-demand by admins (setup) and by scheduled runs (dispatch).
  sdk.registerTool(
    "admin",
    createCreateSchedulesInstructionsTool(),
    "Fetching trivia setup instructions",
  );
  sdk.registerTool(
    "admin",
    createSendQuestionsInstructionsTool(),
    "Fetching question-posting instructions",
  );
  sdk.registerTool(
    "admin",
    createProcessResponsesInstructionsTool(),
    "Fetching response-processing instructions",
  );
};
