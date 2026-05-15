import type { ClackSdk, ClackPlugin } from "../sdk.js";
import { getConfig } from "../../config.js";
import { logger } from "../../logger.js";
import { createSdkDataLayer } from "./data.js";
import { SEED_CATEGORIES } from "./seedCategories.js";
import { createAddCategoriesTool } from "./addCategories.js";
import { createRemoveCategoriesTool } from "./removeCategories.js";
import { createGetIdeasTool } from "./getIdeas.js";
import { createSaveQuestionTool } from "./saveQuestion.js";
import { createFindPreviousQuestionsTool } from "./findPreviousQuestions.js";
import { createGetQuestionHistoryTool } from "./getQuestionHistory.js";
import { createSubmitAnswersTool } from "./submitAnswers.js";
import { createRetrieveScoresTool } from "./retrieveScores.js";
import { createSaveCheatingTool } from "./saveCheating.js";
import { createSendQuestionsInstructionsTool } from "./sendQuestionsInstructions.js";
import { createProcessResponsesInstructionsTool } from "./processResponsesInstructions.js";
import { createCreateSchedulesInstructionsTool } from "./createSchedulesInstructions.js";
import { createCheckSeasonStatusTool } from "./checkSeasonStatus.js";
import { createUpsertSeasonTool } from "./upsertSeason.js";
import { createDeleteSeasonTool } from "./deleteSeason.js";
import { createListSeasonsTool } from "./listSeasons.js";
import { getTriviaCheckInstruction } from "./triviaCheckInstruction.js";

function isSeasonsEnabled(): boolean {
  try {
    const cfg = getConfig();
    return cfg.trivia?.seasons?.enabled === true;
  } catch {
    // Config not yet loaded (e.g. tests) — default to off.
    return false;
  }
}

function initialSlug(now: Date): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `season-${yyyy}-${mm}`;
}

function endOfCurrentMonthUtc(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999);
}

export const triviaPlugin: ClackPlugin = async (sdk: ClackSdk) => {
  const data = createSdkDataLayer(sdk);
  const seasonsEnabled = isSeasonsEnabled();

  // Seed categories on first load
  const categories = await data.loadCategories();
  if (categories.length === 0) {
    await data.saveCategories(SEED_CATEGORIES);
  }

  // Initialize seasons.json on first boot after enabling seasons.
  // Pre-existing entries stay untagged — they contribute to All Time but not to the new Current Season.
  if (seasonsEnabled && (await data.loadSeasonsState()) === null) {
    const now = new Date();
    const baseline = await data.loadCategories();
    const slug = initialSlug(now);
    await data.saveSeasonsState({
      seasons: [
        {
          slug,
          startedAt: now.getTime(),
          expectedEndAt: endOfCurrentMonthUtc(now),
          categories: [...baseline],
        },
      ],
    });
    logger.info(
      `[plugin:trivia] initialized seasons.json with "${slug}" (seeded ${baseline.length} categories)`,
    );
  }

  sdk.addInstruction("user", "trivia-check", getTriviaCheckInstruction(seasonsEnabled));

  sdk.registerTool("owner", createAddCategoriesTool(data), "Adding trivia categories");
  sdk.registerTool("owner", createRemoveCategoriesTool(data), "Removing trivia categories");
  sdk.registerTool("owner", createGetIdeasTool(data), "Getting trivia category ideas");
  sdk.registerTool("owner", createSaveQuestionTool(data), "Saving trivia question — {category}");
  sdk.registerTool(
    "member",
    createFindPreviousQuestionsTool(data),
    "Searching past trivia questions",
  );
  sdk.registerTool("admin", createGetQuestionHistoryTool(data), "Loading trivia question history");
  sdk.registerTool("owner", createSubmitAnswersTool(data), "Submitting trivia answers");
  sdk.registerTool("member", createRetrieveScoresTool(data), "Retrieving trivia scores");

  // Hidden from Slack task cards — the recorded user must not see this fire.
  sdk.registerTool("member", createSaveCheatingTool(data, sdk), {
    label: "Reviewing response",
    hidden: true,
  });

  // Instruction tools — called on-demand by admins (setup) and by scheduled runs (dispatch).
  sdk.registerTool(
    "admin",
    createCreateSchedulesInstructionsTool(seasonsEnabled),
    "Fetching trivia setup instructions",
  );
  sdk.registerTool(
    "admin",
    createSendQuestionsInstructionsTool(),
    "Fetching question-posting instructions",
  );
  sdk.registerTool(
    "admin",
    createProcessResponsesInstructionsTool(seasonsEnabled),
    "Fetching response-processing instructions",
  );

  if (seasonsEnabled) {
    sdk.registerTool("admin", createCheckSeasonStatusTool(data), "Checking trivia season status");
    sdk.registerTool("admin", createUpsertSeasonTool(data), "Upserting trivia season — {slug}");
    sdk.registerTool("admin", createDeleteSeasonTool(data), "Deleting trivia season — {slug}");
    sdk.registerTool("admin", createListSeasonsTool(data), "Listing trivia seasons");
    logger.info(
      "[plugin:trivia] seasons enabled — registered check_season_status, upsert_season, delete_season, list_seasons",
    );
  }
};
