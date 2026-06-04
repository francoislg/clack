import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { CronExpressionParser } from "cron-parser";
import { textResult, errorResult } from "../../../../tools/helpers.js";
import {
  loadTriviaConfig,
  saveTriviaConfig,
  defaultGetGames,
  type GetGamesFn,
} from "../../core/configBridge.js";
import { findCurrentSeason } from "../../core/seasonTimeline.js";
import { detectGameWriteShadowing, type WrittenField } from "../../domain/shadowing.js";
import type { TriviaDataLayer } from "../../core/types.js";
import type {
  JsonObject,
  JsonValue,
  RevealResponsesMode,
  TriviaConfig,
  TriviaGame,
  TriviaHintConfig,
} from "../../core/configTypes.js";
import {
  REVEAL_RESPONSES_VALUES,
  answersFormatZod,
  contextsZod,
  difficultyZod,
  freeformAnswerShapeZod,
  parseTriviaAxisBag,
  questionTypeZod,
  triviaAllTimeRowZod,
  triviaFinalRevealSummaryZod,
  triviaIncludeRevealInQuestionsZod,
  triviaDifficultyRatioZod,
  triviaHintZod,
  triviaJudgeLeniencyZod,
  triviaTellMeMoreZod,
  validateHintConfig,
  type ParseIssue,
} from "../../core/configParsers/axes.js";
import {
  normalizeAdditionalInstructions,
  normalizeCategories,
  normalizeInstructions,
  normalizeTheme,
  seasonFormatZod,
  triviaAdditionalInstructionsZod,
  triviaCategoriesZod,
  triviaInstructionsZod,
  triviaThemeZod,
  validateFormat,
} from "../../core/configParsers/format.js";

const TRIVIA_GAME_NAME_RE = /^[a-z0-9-]+$/;
const CHANNEL_RE = /^[CGD][A-Z0-9_]+$/;

const axisBagSchema = {
  answersFormat: answersFormatZod
    .nullable()
    .optional()
    .describe(
      "Per-game answer-format weights. On UPDATE: explicit null clears the field. Cascade slot → season → game → workspace → default.",
    ),
  questionType: questionTypeZod
    .nullable()
    .optional()
    .describe("Per-game fact-vs-topical weights. Explicit null clears."),
  freeformAnswerShape: freeformAnswerShapeZod
    .nullable()
    .optional()
    .describe("Per-game freeform-shape weights. Explicit null clears."),
  contexts: contextsZod.nullable().optional().describe("Per-game lens list. Explicit null clears."),
  difficulty: difficultyZod
    .nullable()
    .optional()
    .describe(
      "Per-game per-format difficulty overrides. Fields cascade per sub-field — overriding just freeform.hard is fine. Explicit null clears the whole game-tier difficulty.",
    ),
  difficultyRatio: triviaDifficultyRatioZod
    .nullable()
    .optional()
    .describe(
      "Per-game per-format bucket-roll ratio. Each format key carries { easy, medium, hard } non-negative integer weights (at least one strictly positive). Whole-object replace per cascade tier — partial maps inherit nothing; missing buckets within a map normalize to 0. Explicit null clears.",
    ),
};

const structuralFieldsSchema = {
  format: seasonFormatZod
    .nullable()
    .optional()
    .describe(
      "Per-game question composition (slot list). Cascade: `season.format → game.format → (single-question fallback)`. Each slot may narrow `label` / `categories` / `answersFormat` / `questionType` / `freeformAnswerShape` / `contexts` / `difficulty` / `difficultyRatio`; missing fields cascade to the game's defaults. On UPDATE: explicit null clears the field.",
    ),
  categories: triviaCategoriesZod
    .nullable()
    .optional()
    .describe(
      "Per-game category pool. Cascade: `slot.categories → season.categories → game.categories → categories.json`. Non-empty, deduped string list when present. On UPDATE: explicit null clears the field (game then falls through to the global categories.json).",
    ),
  theme: triviaThemeZod
    .nullable()
    .optional()
    .describe(
      "Per-game narrative theme. Cascade: `season.theme → game.theme → (no theme)`. Trimmed, non-empty when present — surfaced in opener / finale prompt copy. On UPDATE: explicit null clears the field.",
    ),
  liveAnswersVisible: z
    .boolean()
    .nullable()
    .optional()
    .describe(
      'Per-game override for the live-roster-footer visibility axis. When `true` (the cascaded default), the live "📝 Answered" footer reveals each answerer\'s pick alongside their name. When `false`, the footer shows only names. Cascade: `slot → season → game → workspace → true`. On UPDATE: explicit null clears the field.',
    ),
  revealResponses: z
    .enum(REVEAL_RESPONSES_VALUES as readonly [RevealResponsesMode, ...RevealResponsesMode[]])
    .nullable()
    .optional()
    .describe(
      'Per-game override for the reveal-time participation disclosure axis. `"yes"` (default) renders full named voter buckets including freeform answer text. `"just-correctness"` renders named buckets but hides typed freeform text. `"just-winners"` names ONLY the correct voters and reduces the missers to anonymous counts (winners-only flair). `"no"` renders only the answer plus reactions plus the leaderboard. Cascade: `slot → season → game → workspace → "yes"`. On UPDATE: explicit null clears the field.',
    ),
  instructions: triviaInstructionsZod
    .nullable()
    .optional()
    .describe(
      'Per-game tier of the replace-cascade `instructions` axis (e.g. "Be dry."). Cascade: `slot → season → game → workspace → null`. When set, the highest-precedence non-empty tier wins. Surfaced verbatim to Claude via the `get_ideas` and `process_reveal_answers` payloads. On UPDATE: explicit null clears the field.',
    ),
  additionalInstructions: triviaAdditionalInstructionsZod
    .nullable()
    .optional()
    .describe(
      'Per-game tier of the cumulative-cascade `additionalInstructions` axis (e.g. "Be concise."). Every non-empty tier stacks — workspace + game + season + slot all apply, concatenated tier-labeled. Surfaced verbatim to Claude via the `get_ideas` and `process_reveal_answers` payloads. On UPDATE: explicit null clears this tier (other tiers keep theirs).',
    ),
  hint: triviaHintZod
    .nullable()
    .optional()
    .describe(
      'Per-game tier of the hint axis. Object shape `{ mode: "none" | "button" | "inline", minDifficulty?: "easy" | "medium" | "hard" }`. Cascade: `slot → season → game → workspace → { mode: "none" }`. Whole-object replace per tier. `button` is per-player opt-in safety net; `inline` is a room-wide difficulty floor adjustment — pick deliberately. On UPDATE: explicit null clears the field.',
    ),
  allTimeRow: triviaAllTimeRowZod
    .nullable()
    .optional()
    .describe(
      'Per-game tier of the "All Time" leaderboard-row visibility axis. One of `"always"` | `"never"` | `"end-of-season-only"`. Controls the All-Time surface at reveal time — the normal-reveal `All Time` row AND the season-finale All-Time table (also requires prior seasons to exist). `"end-of-season-only"` (the workspace default) shows All Time only on the season\'s last fire. Cascade: `game → workspace → "end-of-season-only"`. On UPDATE: explicit null clears the field.',
    ),
  tagPlayers: z
    .boolean()
    .nullable()
    .optional()
    .describe(
      "Per-game tier of the `tagPlayers` knob. `true` (the default) names players with real `<@USERID>` Slack mentions everywhere — reveal post, in-thread narrative, finale podium, live answer roster, and reveal footer — which pings them. `false` renders every player as plain-text `@displayName` instead, so no trivia surface pings the room. Cascade: `game → workspace → true`. On UPDATE: explicit null clears the field.",
    ),
  includeRevealInQuestions: triviaIncludeRevealInQuestionsZod
    .nullable()
    .optional()
    .describe(
      'Per-game tier of the "narrative in cards" axis. One of `"yes"` | `"no"`. `"yes"` makes each revealed question\'s card carry the authored reveal narrative (WHY / fun-fact / "nobody cracked it"), appended beneath the deterministic facts footer; `"no"` (the default) keeps cards facts-only with the narrative in the summary. Cascade: `game → workspace → "no"`. On UPDATE: explicit null clears the field.',
    ),
  finalRevealSummary: triviaFinalRevealSummaryZod
    .nullable()
    .optional()
    .describe(
      'Per-game tier of the reveal-summary narrative placement axis. One of `"yes"` | `"no"` | `"in-thread"`. Governs ONLY the verdict/WHY/voter-breakdown narrative — the leaderboard always posts top-level. `"yes"` (the default) posts the narrative top-level alongside the leaderboard; `"no"` omits the narrative entirely (leaderboard-only top-level); `"in-thread"` posts the leaderboard + a "see in thread" pointer top-level and moves the narrative to a threaded reply. Cascade: `game → workspace → "yes"`. On UPDATE: explicit null clears the field.',
    ),
  judgeLeniency: triviaJudgeLeniencyZod
    .nullable()
    .optional()
    .describe(
      'Per-game tier of the reveal-judge leniency axis for freeform answers. One of `"strict"` | `"strict-with-typos"` | `"lenient"`. `"strict"` forgives only case, numeral↔word substitution, decade-form, and singular/plural; `"strict-with-typos"` (the workspace default) adds typo + loose-writing tolerance; `"lenient"` accepts any rendering that unmistakably shows the player knew the answer. Resolved at save time and stamped on each freeform question. Cascade: `slot → season → game → workspace → "strict-with-typos"`. Whole-value replace per tier. On UPDATE: explicit null clears the field.',
    ),
  tellMeMore: triviaTellMeMoreZod
    .nullable()
    .optional()
    .describe(
      'Per-game tier of the "Tell me more" reveal affordance. Object shape `{ enabled: boolean }`. When enabled, the revealed question card grows a "Tell me more" button that starts a thread conversation asking Clack for deeper detail about the question/answer. Cascade: `game → workspace → { enabled: false }` (no season/slot tier). On UPDATE: explicit null clears the field.',
    ),
};

export function createUpsertGameTool(
  getGamesFn: GetGamesFn = defaultGetGames,
  data?: TriviaDataLayer,
) {
  return tool(
    "upsert_game",
    'Create OR update a trivia game in data/plugins/trivia/config.json. CREATE branch: triggered when the named game doesn\'t exist yet — requires channel, questionCron, revealCron, timezone; enabled defaults to true. UPDATE branch: triggered when the game exists — every scheduling field is omit-to-keep (only update what you pass), every axis field AND every structural field (`format`, `categories`, `theme`) uses null-to-clear / omit-to-keep semantics. `prepCron` is an OPTIONAL scheduling field that opts the game into pre-staging — when set, the plugin emits a third channelless cron spec for `<name>:prep` and the question cron switches to the staged-pool-aware POST prompt; when absent, the legacy gen-and-post behavior is preserved. Game name is immutable — to rename, delete + upsert. Axis fields participate in the cascade slot → season → game → workspace → built-in default. Structural fields participate in the cascade season → game → (fallback). For workspace-tier changes use set_workspace_config. Mutates the plugin config file directly — no confirm/approval flow. When a field you write is masked by a higher cascade tier, the result includes `shadowedBy: { tier: "season" | "slot", slug?, fields: string[] }` (`fields` is a string array; `"format"` appears as a string pseudo-field; `slug` only for season). This means your game-tier edit will NOT take effect for the active season (or for the slot that masks it): surface this to the admin and offer to apply it to the current season too — on confirmation, clear the season override(s) with `upsert_season(slug, { <field>: null, ... })` so they fall through to the new game value.',
    {
      name: z
        .string()
        .describe(
          "Game identifier (immutable). Must match /^[a-z0-9-]+$/, length 1–32. Used as the directory name under data/plugins/trivia/games/.",
        ),
      channel: z
        .string()
        .optional()
        .describe(
          "Slack channel ID (C…/G…/D…). REQUIRED when creating a new game; on update, omit to keep the current value.",
        ),
      questionCron: z
        .string()
        .optional()
        .describe(
          "Cron expression for daily question post. REQUIRED on create; omit on update to keep.",
        ),
      revealCron: z
        .string()
        .optional()
        .describe("Cron expression for daily reveal. REQUIRED on create; omit on update to keep."),
      prepCron: z
        .string()
        .nullable()
        .optional()
        .describe(
          "Optional cron expression for the pre-staging run, evaluated in the game's timezone. When set, the plugin emits a third channelless cron spec (`<name>:prep`) that gen-saves questions ahead of the question cron WITHOUT posting. The question cron then picks the oldest staged question per slot, falling back to inline-gen for missing slots. The bot does NOT derive this value automatically; YOU propose it conversationally (typically 30 minutes before questionCron) and the admin confirms or overrides. Watch for midnight crossings — shifting `0 0 * * *` back 30 min produces `30 23 * * *` which fires on the PREVIOUS calendar day; surface this trade-off when proposing. UPDATE semantics: omit to keep current value; pass `null` to clear and disable pre-staging.",
        ),
      timezone: z
        .string()
        .optional()
        .describe(
          "IANA timezone the cron expressions are interpreted in. REQUIRED on create; omit on update to keep.",
        ),
      enabled: z
        .boolean()
        .optional()
        .describe(
          "When false, the plugin skips this entry during cron reconcile AND per-game write tools refuse. Defaults to true on create; omit on update to keep.",
        ),
      ...axisBagSchema,
      ...structuralFieldsSchema,
    },
    async (args) => {
      if (!TRIVIA_GAME_NAME_RE.test(args.name) || args.name.length > 32) {
        return errorResult(
          `Invalid game name "${args.name}": must match /^[a-z0-9-]+$/ and be 1-32 chars.`,
        );
      }

      const games = [...getGamesFn()];
      const existingIndex = games.findIndex((g) => g.name === args.name);
      const isCreate = existingIndex === -1;
      const existing = isCreate ? null : games[existingIndex];

      const channel = args.channel ?? existing?.channel;
      const questionCron = args.questionCron ?? existing?.questionCron;
      const revealCron = args.revealCron ?? existing?.revealCron;
      const timezone = args.timezone ?? existing?.timezone;

      if (isCreate) {
        if (!channel || !questionCron || !revealCron || !timezone) {
          return errorResult(
            "Creating a new game requires channel, questionCron, revealCron, and timezone.",
          );
        }
      }
      if (channel === undefined || !CHANNEL_RE.test(channel)) {
        return errorResult(
          `Invalid channel "${channel ?? ""}": must be a Slack channel ID (C…/G…/D…).`,
        );
      }
      if (!timezone || timezone.length === 0) {
        return errorResult("timezone must be a non-empty IANA tz string.");
      }
      if (!questionCron || !revealCron) {
        return errorResult("questionCron and revealCron are both required.");
      }
      try {
        CronExpressionParser.parse(questionCron, { tz: timezone });
      } catch (err) {
        return errorResult(
          `Invalid questionCron "${questionCron}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      try {
        CronExpressionParser.parse(revealCron, { tz: timezone });
      } catch (err) {
        return errorResult(
          `Invalid revealCron "${revealCron}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // Resolve prepCron with null-to-clear / omit-to-keep semantics:
      // - undefined (omitted)  → keep existing.prepCron
      // - null                 → clear (remove the field)
      // - string               → validate + set
      let prepCron: string | undefined;
      if (args.prepCron === null) {
        prepCron = undefined;
      } else if (args.prepCron === undefined) {
        prepCron = existing?.prepCron;
      } else {
        try {
          CronExpressionParser.parse(args.prepCron, { tz: timezone });
        } catch (err) {
          return errorResult(
            `Invalid prepCron "${args.prepCron}": ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        prepCron = args.prepCron;
      }

      // Validate axis fields via the shared parser. Issues become hard errors here
      // (strict mode); the parser itself does no I/O.
      const axisInput: JsonObject = {};
      const setAxis = (key: string, value: JsonValue | undefined): void => {
        if (value !== undefined) axisInput[key] = value;
      };
      setAxis("answersFormat", args.answersFormat ?? undefined);
      setAxis("questionType", args.questionType ?? undefined);
      setAxis("freeformAnswerShape", args.freeformAnswerShape ?? undefined);
      setAxis("contexts", args.contexts ?? undefined);
      setAxis("difficulty", args.difficulty ?? undefined);
      setAxis("difficultyRatio", args.difficultyRatio ?? undefined);

      const issues: ParseIssue[] = [];
      let parsedAxes: Partial<TriviaGame> = {};
      if (Object.keys(axisInput).length > 0) {
        const result = parseTriviaAxisBag(axisInput, `upsert_game(${args.name})`);
        issues.push(...result.issues);
        parsedAxes = result.axes;
      }

      // Validate the three structural fields with the same validators used at
      // file-load time, so the tool path and the file-loader path stay in sync.
      let parsedFormat: TriviaGame["format"] | undefined;
      if (args.format !== undefined && args.format !== null) {
        const r = validateFormat(args.format, `upsert_game(${args.name}).format`);
        if (!r.ok) issues.push({ field: "format", error: r.error });
        else parsedFormat = r.value;
      }
      let parsedCategories: string[] | undefined;
      if (args.categories !== undefined && args.categories !== null) {
        const r = normalizeCategories(args.categories);
        if (!r.ok) issues.push({ field: "categories", error: r.error });
        else parsedCategories = r.value;
      }
      let parsedTheme: string | undefined;
      if (args.theme !== undefined && args.theme !== null) {
        const r = normalizeTheme(args.theme);
        if (!r.ok) issues.push({ field: "theme", error: r.error });
        else parsedTheme = r.value;
      }
      let parsedInstructions: string | undefined;
      if (args.instructions !== undefined && args.instructions !== null) {
        const r = normalizeInstructions(args.instructions);
        if (!r.ok) issues.push({ field: "instructions", error: r.error });
        else parsedInstructions = r.value;
      }
      let parsedAdditionalInstructions: string | undefined;
      if (args.additionalInstructions !== undefined && args.additionalInstructions !== null) {
        const r = normalizeAdditionalInstructions(args.additionalInstructions);
        if (!r.ok) issues.push({ field: "additionalInstructions", error: r.error });
        else parsedAdditionalInstructions = r.value;
      }
      let parsedHint: TriviaHintConfig | undefined;
      if (args.hint !== undefined && args.hint !== null) {
        const r = validateHintConfig(args.hint, "hint");
        if (!r.ok) issues.push({ field: "hint", error: r.error });
        else parsedHint = r.value;
      }

      if (issues.length > 0) {
        return errorResult(issues.map((i) => `${i.field}: ${i.error}`).join("; "));
      }

      // Merge axes: start from existing, apply null-clears and value-replaces.
      const mergedAxes: Partial<TriviaGame> = {
        ...(existing?.answersFormat !== undefined ? { answersFormat: existing.answersFormat } : {}),
        ...(existing?.questionType !== undefined ? { questionType: existing.questionType } : {}),
        ...(existing?.freeformAnswerShape !== undefined
          ? { freeformAnswerShape: existing.freeformAnswerShape }
          : {}),
        ...(existing?.contexts !== undefined ? { contexts: existing.contexts } : {}),
        ...(existing?.difficulty !== undefined ? { difficulty: existing.difficulty } : {}),
        ...(existing?.difficultyRatio !== undefined
          ? { difficultyRatio: existing.difficultyRatio }
          : {}),
      };
      if (args.answersFormat === null) delete mergedAxes.answersFormat;
      else if (parsedAxes.answersFormat !== undefined)
        mergedAxes.answersFormat = parsedAxes.answersFormat;
      if (args.questionType === null) delete mergedAxes.questionType;
      else if (parsedAxes.questionType !== undefined)
        mergedAxes.questionType = parsedAxes.questionType;
      if (args.freeformAnswerShape === null) delete mergedAxes.freeformAnswerShape;
      else if (parsedAxes.freeformAnswerShape !== undefined)
        mergedAxes.freeformAnswerShape = parsedAxes.freeformAnswerShape;
      if (args.contexts === null) delete mergedAxes.contexts;
      else if (parsedAxes.contexts !== undefined) mergedAxes.contexts = parsedAxes.contexts;
      if (args.difficulty === null) delete mergedAxes.difficulty;
      else if (parsedAxes.difficulty !== undefined) mergedAxes.difficulty = parsedAxes.difficulty;
      if (args.difficultyRatio === null) delete mergedAxes.difficultyRatio;
      else if (parsedAxes.difficultyRatio !== undefined)
        mergedAxes.difficultyRatio = parsedAxes.difficultyRatio;

      // Merge structural fields with the same null-clear / value-replace /
      // omit-to-keep semantics.
      // tagPlayers clear (null) → omit the key; set → take the arg; else keep existing.
      // Computed here (not spread-then-`delete`d) so a cleared field leaves no key behind.
      const nextTagPlayers: boolean | undefined =
        args.tagPlayers === null
          ? undefined
          : args.tagPlayers !== undefined
            ? args.tagPlayers
            : existing?.tagPlayers;

      const mergedStructural: Partial<TriviaGame> = {
        ...(existing?.format !== undefined ? { format: existing.format } : {}),
        ...(existing?.categories !== undefined ? { categories: existing.categories } : {}),
        ...(existing?.theme !== undefined ? { theme: existing.theme } : {}),
        ...(existing?.instructions !== undefined ? { instructions: existing.instructions } : {}),
        ...(existing?.additionalInstructions !== undefined
          ? { additionalInstructions: existing.additionalInstructions }
          : {}),
        ...(existing?.liveAnswersVisible !== undefined
          ? { liveAnswersVisible: existing.liveAnswersVisible }
          : {}),
        ...(existing?.revealResponses !== undefined
          ? { revealResponses: existing.revealResponses }
          : {}),
        ...(existing?.hint !== undefined ? { hint: existing.hint } : {}),
        ...(existing?.judgeLeniency !== undefined ? { judgeLeniency: existing.judgeLeniency } : {}),
        ...(existing?.allTimeRow !== undefined ? { allTimeRow: existing.allTimeRow } : {}),
        ...(nextTagPlayers !== undefined ? { tagPlayers: nextTagPlayers } : {}),
        ...(existing?.includeRevealInQuestions !== undefined
          ? { includeRevealInQuestions: existing.includeRevealInQuestions }
          : {}),
        ...(existing?.finalRevealSummary !== undefined
          ? { finalRevealSummary: existing.finalRevealSummary }
          : {}),
        ...(existing?.tellMeMore !== undefined ? { tellMeMore: existing.tellMeMore } : {}),
      };
      if (args.format === null) delete mergedStructural.format;
      else if (parsedFormat !== undefined) mergedStructural.format = parsedFormat;
      if (args.categories === null) delete mergedStructural.categories;
      else if (parsedCategories !== undefined) mergedStructural.categories = parsedCategories;
      if (args.theme === null) delete mergedStructural.theme;
      else if (parsedTheme !== undefined) mergedStructural.theme = parsedTheme;
      if (args.instructions === null) delete mergedStructural.instructions;
      else if (parsedInstructions !== undefined) mergedStructural.instructions = parsedInstructions;
      if (args.additionalInstructions === null) delete mergedStructural.additionalInstructions;
      else if (parsedAdditionalInstructions !== undefined)
        mergedStructural.additionalInstructions = parsedAdditionalInstructions;
      if (args.liveAnswersVisible === null) delete mergedStructural.liveAnswersVisible;
      else if (args.liveAnswersVisible !== undefined)
        mergedStructural.liveAnswersVisible = args.liveAnswersVisible;
      if (args.revealResponses === null) delete mergedStructural.revealResponses;
      else if (args.revealResponses !== undefined)
        mergedStructural.revealResponses = args.revealResponses;
      if (args.hint === null) delete mergedStructural.hint;
      else if (parsedHint !== undefined) mergedStructural.hint = parsedHint;
      if (args.allTimeRow === null) delete mergedStructural.allTimeRow;
      else if (args.allTimeRow !== undefined) mergedStructural.allTimeRow = args.allTimeRow;
      if (args.includeRevealInQuestions === null) delete mergedStructural.includeRevealInQuestions;
      else if (args.includeRevealInQuestions !== undefined)
        mergedStructural.includeRevealInQuestions = args.includeRevealInQuestions;
      if (args.finalRevealSummary === null) delete mergedStructural.finalRevealSummary;
      else if (args.finalRevealSummary !== undefined)
        mergedStructural.finalRevealSummary = args.finalRevealSummary;
      if (args.tellMeMore === null) delete mergedStructural.tellMeMore;
      else if (args.tellMeMore !== undefined) mergedStructural.tellMeMore = args.tellMeMore;
      if (args.judgeLeniency === null) delete mergedStructural.judgeLeniency;
      else if (args.judgeLeniency !== undefined)
        mergedStructural.judgeLeniency = args.judgeLeniency;

      const enabled = args.enabled ?? existing?.enabled ?? true;

      const next: TriviaGame = {
        name: args.name,
        channel,
        questionCron,
        revealCron,
        timezone,
        enabled,
        ...(prepCron !== undefined ? { prepCron } : {}),
        ...mergedAxes,
        ...mergedStructural,
      };
      if (isCreate) games.push(next);
      else games[existingIndex] = next;

      const currentConfig: TriviaConfig = loadTriviaConfig() ?? {};
      const nextConfig: TriviaConfig = { ...currentConfig, games };
      await saveTriviaConfig(nextConfig);

      const hasAxisOverrides = Object.keys(mergedAxes).length > 0;
      const hasStructuralOverrides = Object.keys(mergedStructural).length > 0;

      // The fields this call wrote with a concrete value (null clears the game tier, so it
      // can't be shadowed). Shadowing tells the admin a higher tier masks their edit.
      const writtenFields: WrittenField[] = [];
      const wrote = (v: unknown): boolean => v !== undefined && v !== null;
      if (wrote(args.answersFormat)) writtenFields.push("answersFormat");
      if (wrote(args.questionType)) writtenFields.push("questionType");
      if (wrote(args.freeformAnswerShape)) writtenFields.push("freeformAnswerShape");
      if (wrote(args.contexts)) writtenFields.push("contexts");
      if (wrote(args.difficulty)) writtenFields.push("difficulty");
      if (wrote(args.difficultyRatio)) writtenFields.push("difficultyRatio");
      if (wrote(args.hint)) writtenFields.push("hint");
      if (wrote(args.judgeLeniency)) writtenFields.push("judgeLeniency");
      if (wrote(args.instructions)) writtenFields.push("instructions");
      if (wrote(args.additionalInstructions)) writtenFields.push("additionalInstructions");
      if (wrote(args.liveAnswersVisible)) writtenFields.push("liveAnswersVisible");
      if (wrote(args.revealResponses)) writtenFields.push("revealResponses");
      if (wrote(args.format)) writtenFields.push("format");

      const shadowedBy =
        data !== undefined && writtenFields.length > 0
          ? detectGameWriteShadowing(
              writtenFields,
              findCurrentSeason(await data.forGame(args.name).loadSeasonsState(), Date.now()),
              next,
            )
          : undefined;

      return textResult({
        name: args.name,
        action: isCreate ? "created" : "updated",
        ...(shadowedBy !== undefined ? { shadowedBy } : {}),
        enabled,
        hasAxisOverrides,
        hasStructuralOverrides,
        hasFormat: mergedStructural.format !== undefined,
        hasCategories: mergedStructural.categories !== undefined,
        hasTheme: mergedStructural.theme !== undefined,
        hasInstructions: mergedStructural.instructions !== undefined,
        hasAdditionalInstructions: mergedStructural.additionalInstructions !== undefined,
        hasLiveAnswersVisible: mergedStructural.liveAnswersVisible !== undefined,
        hasRevealResponses: mergedStructural.revealResponses !== undefined,
        hasHint: mergedStructural.hint !== undefined,
        hasJudgeLeniency: mergedStructural.judgeLeniency !== undefined,
        hasAllTimeRow: mergedStructural.allTimeRow !== undefined,
        hasTagPlayers: mergedStructural.tagPlayers !== undefined,
        hasIncludeRevealInQuestions: mergedStructural.includeRevealInQuestions !== undefined,
        hasFinalRevealSummary: mergedStructural.finalRevealSummary !== undefined,
        hasTellMeMore: mergedStructural.tellMeMore !== undefined,
        slotCount: mergedStructural.format?.questions.length ?? 0,
      });
    },
  );
}
