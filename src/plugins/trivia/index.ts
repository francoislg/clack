import type { ClackSdk, ClackPlugin } from "../sdk.js";
import { getConfig, type TriviaGame, type OffDay } from "../../config.js";
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
import { createListGamesTool } from "./listGames.js";
import { createCheckSeasonStatusTool } from "./checkSeasonStatus.js";
import { createUpsertSeasonTool } from "./upsertSeason.js";
import { createDeleteSeasonTool } from "./deleteSeason.js";
import { createListSeasonsTool } from "./listSeasons.js";
import {
  getTriviaCheckInstruction,
  TRIVIA_GAMES_ADMIN_INSTRUCTION,
} from "./triviaCheckInstruction.js";
import { buildGameSpecs } from "./buildGameSpecs.js";

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
  const specs = buildGameSpecs(games, seasonsEnabled, offDays);
  await sdk.reconcileCronJobs("trivia", specs);
  if (games.length > 0) {
    logger.info(
      `[plugin:trivia] reconciled ${specs.length} cron job specs across ${games.length} game(s)`,
    );
  }
};
