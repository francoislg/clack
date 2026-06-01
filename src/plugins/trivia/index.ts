import type { ClackSdk, ClackPlugin } from "../sdk.js";
import { initTriviaConfigBridge, loadTriviaConfig } from "./core/configBridge.js";
import type { TriviaGame, OffDay } from "./core/configTypes.js";
import { setTriviaLogger } from "./core/pluginLogger.js";
import { en as triviaEn, fr as triviaFr } from "./i18n/strings.js";
import { setTriviaT } from "./i18n/t.js";
import { createSdkDataLayer } from "./core/dataLayer.js";
import { SEED_CATEGORIES } from "./core/seedCategories.js";
import { createAddCategoriesTool } from "./tools/categories/addCategories.js";
import { createRemoveCategoriesTool } from "./tools/categories/removeCategories.js";
import { createGetIdeasTool } from "./tools/questions/getIdeas.js";
import { createSaveQuestionTool } from "./tools/questions/saveQuestion.js";
import { createPostQuestionsTool } from "./tools/questions/postQuestions.js";
import { createFindPreviousQuestionsTool } from "./tools/questions/findPreviousQuestions.js";
import { createFindPreviousSubjectsTool } from "./tools/visual/findPreviousSubjects.js";
import { createGetQuestionHistoryTool } from "./tools/questions/getQuestionHistory.js";
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
  TRIVIA_MANAGEMENT_DESCRIPTION,
} from "./prompts/triviaCheckInstruction.js";
import {
  PERSONA_CONTENT,
  REVEAL_TONE_CONTENT,
  FINALE_TONE_CONTENT,
} from "./prompts/topicInstructions.js";
import { buildGameSpecs } from "./domain/buildGameSpecs.js";
import { registerInteractiveHandlers } from "./answerTypes/installInteractions.js";
import { installHintButtonHandler } from "./answerTypes/hintButton.js";
import { installSeeAnswerHandler } from "./revealCards/seeAnswerHandler.js";

export const triviaPlugin: ClackPlugin = async (sdk: ClackSdk) => {
  // Trivia is built around scheduled question/reveal cron jobs — without the scheduler
  // tick loop running, none of its tools or instructions do anything useful. Refuse to
  // load with a clear reason so admins see it in the Home Tab plugin status banner.
  if (!sdk.capabilities.crons) {
    sdk.error("Trivia requires the cron scheduler. Enable it via `config.cron.enabled: true`.");
    return;
  }

  // Wire the plugin-local logger so utility modules (which don't take SDK args)
  // can log through the plugin-prefixed sink. Do this FIRST so initTriviaConfigBridge
  // (and anything else it calls) gets its warnings/errors attributed correctly.
  setTriviaLogger(sdk.logger);

  sdk.registerDictionary({ en: triviaEn, fr: triviaFr });
  setTriviaT(sdk.t);

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
  // On-demand management server — gated config-mutation tools (game/season lifecycle)
  // and the admin-tier "Managing trivia games" instruction live on this handle.
  // `attach_integration("trivia:management")` reveals everything in one shot.
  const management = sdk.registerMcpServer("management", {
    autoload: false,
    description: TRIVIA_MANAGEMENT_DESCRIPTION,
  });
  management.addTopicInstruction("admin", "trivia-management", TRIVIA_MANAGEMENT_INSTRUCTION);

  // Topic-scoped persona / reveal-tone / finale-tone. Loaded only when the `trivia` topic
  // is active for a session — pre-attached by every trivia cron spec (`buildGameSpecs`
  // sets `attachedTopics: ["trivia"]`). Admins override at
  // `data/configuration/user/topics/trivia/trivia__<filename>.md`.
  sdk.addTopicInstruction("user", "trivia", "persona", PERSONA_CONTENT);
  sdk.addTopicInstruction("user", "trivia", "reveal-tone", REVEAL_TONE_CONTENT);
  sdk.addTopicInstruction("user", "trivia", "finale-tone", FINALE_TONE_CONTENT);

  management.registerTool("admin", createAddCategoriesTool(data), sdk.t("label.add_categories"));
  management.registerTool(
    "admin",
    createRemoveCategoriesTool(data),
    sdk.t("label.remove_categories"),
  );
  sdk.registerTool("admin", createGetIdeasTool(data), sdk.t("label.get_ideas"));
  sdk.registerTool("admin", createSaveQuestionTool(data), sdk.t("label.save_question"));
  sdk.registerTool("admin", createPostQuestionsTool(data, sdk), sdk.t("label.post_questions"));
  sdk.registerTool("member", createFindPreviousQuestionsTool(data), sdk.t("label.find_previous"));
  sdk.registerTool(
    "member",
    createFindPreviousSubjectsTool(data),
    sdk.t("label.find_previous_subjects"),
  );
  sdk.registerTool("admin", createGetQuestionHistoryTool(data), sdk.t("label.question_history"));
  sdk.registerTool(
    "admin",
    createProcessRevealAnswersTool(data, sdk),
    sdk.t("label.process_reveal"),
  );
  sdk.registerTool("member", createRetrieveScoresTool(data), sdk.t("label.retrieve_scores"));
  sdk.registerTool(
    "member",
    createListGamesTool(undefined, undefined, () => sdk.findOwnedCronJobs()),
    sdk.t("label.list_games"),
  );

  // trivia:management server — gated game/season lifecycle tools (categories tools above
  // are on the same handle).
  management.registerTool("admin", createUpsertGameTool(), sdk.t("label.upsert_game"));
  management.registerTool("admin", createDeleteGameTool(), sdk.t("label.delete_game"));
  management.registerTool(
    "admin",
    createSetWorkspaceConfigTool(),
    sdk.t("label.set_workspace_config"),
  );

  // Hidden from Slack task cards — the recorded user must not see this fire.
  sdk.registerTool("member", createSaveCheatingTool(data, sdk), {
    label: "Reviewing response",
    hidden: true,
  });

  if (seasonsEnabled) {
    sdk.registerTool("admin", createCheckSeasonStatusTool(data), sdk.t("label.check_season"));
    management.registerTool("admin", createUpsertSeasonTool(data), sdk.t("label.upsert_season"));
    management.registerTool("admin", createDeleteSeasonTool(data), sdk.t("label.delete_season"));
    sdk.registerTool("admin", createListSeasonsTool(data), sdk.t("label.list_seasons"));
    sdk.logger.info(
      "seasons enabled — registered check_season_status, upsert_season, delete_season, list_seasons",
    );
  }

  registerInteractiveHandlers({
    data,
    sdk,
    getGameNames: () => (loadTriviaConfig()?.games ?? []).map((g) => g.name),
  });

  installHintButtonHandler(sdk, {
    data,
    getGameNames: () => (loadTriviaConfig()?.games ?? []).map((g) => g.name),
  });

  installSeeAnswerHandler(sdk, {
    data,
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
