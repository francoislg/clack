import type { ClackSdk, ClackPlugin } from "../sdk.js";
import { initTriviaConfigBridge, loadTriviaConfig } from "./core/configBridge.js";
import type { TriviaGame, OffDay } from "./core/configTypes.js";
import { setTriviaLogger } from "./core/pluginLogger.js";
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
import { createUpsertGameTool } from "./tools/games/upsertGame.js";
import { createDeleteGameTool } from "./tools/games/deleteGame.js";
import { createSetWorkspaceConfigTool } from "./tools/games/setWorkspaceConfig.js";
import { createCheckSeasonStatusTool } from "./tools/seasons/checkSeasonStatus.js";
import { createUpsertSeasonTool } from "./tools/seasons/upsertSeason.js";
import { createDeleteSeasonTool } from "./tools/seasons/deleteSeason.js";
import { createListSeasonsTool } from "./tools/seasons/listSeasons.js";
import { createProcessRevealAnswersTool } from "./tools/reveal/processRevealAnswers.js";
import {
  getTriviaCheckInstruction,
  TRIVIA_GAMES_ADMIN_INSTRUCTION,
  TRIVIA_MANAGEMENT_INSTRUCTION,
} from "./prompts/triviaCheckInstruction.js";
import {
  PERSONA_CONTENT,
  REVEAL_TONE_CONTENT,
  FINALE_TONE_CONTENT,
} from "./prompts/topicInstructions.js";
import { buildGameSpecs } from "./domain/buildGameSpecs.js";
import { registerFreeformHandlers } from "./freeform/handlers.js";

export const triviaPlugin: ClackPlugin = async (sdk: ClackSdk) => {
  // Wire the plugin-local logger so utility modules (which don't take SDK args)
  // can log through the plugin-prefixed sink. Do this FIRST so initTriviaConfigBridge
  // (and anything else it calls) gets its warnings/errors attributed correctly.
  setTriviaLogger(sdk.logger);

  // Warm the trivia plugin's own config cache (data/plugins/trivia/config.json).
  // After this, every tool/resolver reads from the in-memory cache synchronously.
  await initTriviaConfigBridge(sdk);

  const data = createSdkDataLayer(sdk);
  const seasonsEnabled = loadTriviaConfig()?.seasons?.enabled === true;

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
  sdk.addInstruction("admin", "trivia-management", TRIVIA_MANAGEMENT_INSTRUCTION);

  // Topic-scoped persona / reveal-tone / finale-tone. Loaded only when the `trivia` topic
  // is active for a session — pre-attached by every trivia cron spec (`buildGameSpecs`
  // sets `attachedTopics: ["trivia"]`). Admins override at
  // `data/configuration/user/topics/trivia/trivia__<filename>.md`.
  sdk.addTopicInstruction("user", "trivia", "persona", PERSONA_CONTENT);
  sdk.addTopicInstruction("user", "trivia", "reveal-tone", REVEAL_TONE_CONTENT);
  sdk.addTopicInstruction("user", "trivia", "finale-tone", FINALE_TONE_CONTENT);

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

  // trivia_management integration: admin-only tools that mutate
  // data/plugins/trivia/config.json directly. The catalog entry in
  // data/config.json's mcpServers makes attach_integration("trivia_management")
  // a valid call; the topic instructions teach Claude when/how to use them.
  sdk.registerTool("admin", createUpsertGameTool(), "Upserting trivia game — {name}");
  sdk.registerTool("admin", createDeleteGameTool(), "Deleting trivia game — {name}");
  sdk.registerTool(
    "admin",
    createSetWorkspaceConfigTool(),
    "Updating workspace-tier trivia config",
  );

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
    sdk.logger.info(
      "seasons enabled — registered check_season_status, upsert_season, delete_season, list_seasons",
    );
  }

  registerFreeformHandlers({
    data,
    sdk,
    getGameNames: () => (loadTriviaConfig()?.games ?? []).map((g) => g.name),
  });

  // Reconcile plugin-managed cron jobs from games[]. Passing the full spec list
  // (even when empty) is the contract: the SDK deletes prior plugin-managed trivia
  // jobs whose specKey isn't in the new list, so removing a game from config makes
  // its jobs disappear. Disabled games (`enabled: false`) are filtered out inside
  // buildGameSpecs.
  const triviaCfg = loadTriviaConfig();
  const games: TriviaGame[] = triviaCfg?.games ?? [];
  const offDays: OffDay[] | undefined = triviaCfg?.offDays;
  const specs = buildGameSpecs(games, offDays);
  await sdk.reconcileCronJobs("trivia", specs);
  if (games.length > 0) {
    sdk.logger.info(`reconciled ${specs.length} cron job specs across ${games.length} game(s)`);
  }
};
