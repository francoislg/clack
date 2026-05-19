import type { ClackSdk, ClackPlugin } from "../sdk.js";
import { getConfig, type TriviaGame, type OffDay } from "../../config.js";
import { logger } from "../../logger.js";
import { createSdkDataLayer } from "./core/dataLayer.js";
import { SEED_CATEGORIES } from "./core/seedCategories.js";
import { createAddCategoriesTool } from "./tools/categories/addCategories.js";
import { createRemoveCategoriesTool } from "./tools/categories/removeCategories.js";
import { createGetIdeasTool } from "./tools/questions/getIdeas.js";
import { createSaveQuestionTool } from "./tools/questions/saveQuestion.js";
import { createPostQuestionsTool } from "./tools/questions/postQuestions.js";
import { createFindPreviousQuestionsTool } from "./tools/questions/findPreviousQuestions.js";
import { createGetQuestionHistoryTool } from "./tools/questions/getQuestionHistory.js";
import { createSubmitAnswersTool } from "./tools/answers/submitAnswers.js";
import { createRetrieveScoresTool } from "./tools/answers/retrieveScores.js";
import { createSaveCheatingTool } from "./tools/answers/saveCheating.js";
import { createListGamesTool } from "./tools/games/listGames.js";
import { createCheckSeasonStatusTool } from "./tools/seasons/checkSeasonStatus.js";
import { createUpsertSeasonTool } from "./tools/seasons/upsertSeason.js";
import { createDeleteSeasonTool } from "./tools/seasons/deleteSeason.js";
import { createListSeasonsTool } from "./tools/seasons/listSeasons.js";
import { createProcessRevealAnswersTool } from "./tools/reveal/processRevealAnswers.js";
import {
  getTriviaCheckInstruction,
  TRIVIA_GAMES_ADMIN_INSTRUCTION,
} from "./prompts/triviaCheckInstruction.js";
import { buildGameSpecs } from "./domain/buildGameSpecs.js";

function isSeasonsEnabled(): boolean {
  try {
    const cfg = getConfig();
    return cfg.trivia?.seasons?.enabled === true;
  } catch {
    // Config not yet loaded (e.g. tests) — default to off.
    return false;
  }
}

export const triviaPlugin: ClackPlugin = async (sdk: ClackSdk) => {
  const data = createSdkDataLayer(sdk);
  const seasonsEnabled = isSeasonsEnabled();

  // Seed global categories on first load
  const categories = await data.loadCategories();
  if (categories.length === 0) {
    await data.saveCategories(SEED_CATEGORIES);
  }

  // Per-game seasons bootstrap is LAZY (lives in `data.forGame(name).loadSeasonsState`):
  // when a game's seasons.json is missing and `trivia.seasons.enabled` is true, the
  // first per-game tool call seeds the starter season. This avoids tying the bootstrap
  // to a `create_game` event that doesn't exist in the config-driven model — admins
  // just add a config entry and the file appears on first use.

  sdk.addInstruction("user", "trivia-check", getTriviaCheckInstruction(seasonsEnabled));
  // Admin-tier guidance for game management — only loaded in admin+ sessions, so
  // member sessions stay lean. Per cascadingConfigResolver, "admin" instructions
  // cascade up but not down.
  sdk.addInstruction("admin", "trivia-games", TRIVIA_GAMES_ADMIN_INSTRUCTION);

  sdk.registerTool("admin", createAddCategoriesTool(data), "Adding trivia categories — {game}");
  sdk.registerTool(
    "admin",
    createRemoveCategoriesTool(data),
    "Removing trivia categories — {game}",
  );
  sdk.registerTool("admin", createGetIdeasTool(data), "Getting trivia category ideas — {game}");
  sdk.registerTool(
    "admin",
    createSaveQuestionTool(data),
    "Saving trivia question — {game}/{category}",
  );
  sdk.registerTool("admin", createPostQuestionsTool(data, sdk), "Posting trivia question — {game}");
  sdk.registerTool(
    "member",
    createFindPreviousQuestionsTool(data),
    "Searching past trivia questions — {game}",
  );
  sdk.registerTool(
    "admin",
    createGetQuestionHistoryTool(data),
    "Loading trivia question history — {game}",
  );
  sdk.registerTool("admin", createSubmitAnswersTool(data), "Submitting trivia answers — {game}");
  sdk.registerTool(
    "admin",
    createProcessRevealAnswersTool(data, sdk),
    "Processing trivia reveal — {game}",
  );
  sdk.registerTool("member", createRetrieveScoresTool(data), "Retrieving trivia scores — {game}");
  sdk.registerTool("member", createListGamesTool(), "Listing trivia games");

  // Hidden from Slack task cards — the recorded user must not see this fire.
  sdk.registerTool("member", createSaveCheatingTool(data, sdk), {
    label: "Reviewing response",
    hidden: true,
  });

  if (seasonsEnabled) {
    sdk.registerTool(
      "admin",
      createCheckSeasonStatusTool(data),
      "Checking trivia season status — {game}",
    );
    sdk.registerTool(
      "admin",
      createUpsertSeasonTool(data),
      "Upserting trivia season — {game}/{slug}",
    );
    sdk.registerTool(
      "admin",
      createDeleteSeasonTool(data),
      "Deleting trivia season — {game}/{slug}",
    );
    sdk.registerTool("admin", createListSeasonsTool(data), "Listing trivia seasons — {game}");
    logger.info(
      "[plugin:trivia] seasons enabled — registered check_season_status, upsert_season, delete_season, list_seasons",
    );
  }

  // Reconcile plugin-managed cron jobs from `config.trivia.games[]`. Passing the full spec list
  // (even when empty) is the contract: the SDK deletes prior plugin-managed trivia jobs whose
  // specKey isn't in the new list, so removing a game from config makes its jobs disappear.
  // Disabled games (`enabled: false`) are filtered out inside buildGameSpecs.
  let games: TriviaGame[] = [];
  let offDays: OffDay[] | undefined;
  try {
    const triviaCfg = getConfig().trivia;
    games = triviaCfg?.games ?? [];
    offDays = triviaCfg?.offDays;
  } catch {
    // Config not loaded (tests): leave games empty so reconcile is a no-op.
  }
  const specs = buildGameSpecs(games, offDays);
  await sdk.reconcileCronJobs("trivia", specs);
  if (games.length > 0) {
    logger.info(
      `[plugin:trivia] reconciled ${specs.length} cron job specs across ${games.length} game(s)`,
    );
  }
};
