import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { CronExpressionParser } from "cron-parser";
import { textResult } from "../../../../plugins-sdk/sdk.js";
import {
  defaultGetGames,
  defaultGetTriviaConfig,
  type GetGamesFn,
  type GetTriviaConfigFn,
} from "../../core/configBridge.js";
import type {
  PerfectRoundsAward,
  SeasonFormat,
  TeamDef,
  TeamsScoringMode,
  TriviaAnsweringType,
  TriviaAllTimeRowMode,
  TriviaFinalRevealSummary,
  TriviaIncludeRevealInQuestions,
  TriviaSeasonsConfig,
  TriviaHintConfig,
  TriviaTellMeMoreConfig,
  JudgeLeniency,
  RevealResponsesMode,
  OffDay,
} from "../../core/configTypes.js";
import type { CascadeAxes } from "../../core/cascadeAxes.js";
import type { TriviaDataLayer } from "../../core/types.js";
import { AXIS_KEYS, copyAxisIfSet } from "../../domain/resolveCascade.js";
import { resolveTeamsConfig } from "../../domain/teams/resolveTeamsConfig.js";

/**
 * Per-game cascade-axis overrides. Projected from `AXIS_KEYS` (the registry's axis set),
 * so every cascading axis — including `promptMedium`, `liveAnswersVisible`,
 * `revealResponses`, `instructions`, `additionalInstructions` — surfaces automatically;
 * adding a future axis to the registry surfaces it here with no edit.
 */
type AxisOverrides = Partial<CascadeAxes>;

/**
 * Next-fire epoch ms for an optional cron in the game's timezone. Returns `undefined`
 * when the cron is absent or (defensively — the parser validates at config-load time)
 * unparseable, so the caller omits the field rather than failing the whole list.
 */
function nextFireMs(cron: string | undefined, timezone: string): number | undefined {
  if (cron === undefined) return undefined;
  try {
    return CronExpressionParser.parse(cron, { tz: timezone }).next().toDate().getTime();
  } catch {
    return undefined;
  }
}

interface ListGamesEntry {
  name: string;
  channel: string;
  timezone: string;
  enabled: boolean;
  questionCron: string;
  revealCron: string;
  prepCron?: string;
  nextPrepFire?: number;
  lockCron?: string;
  nextLockFire?: number;
  questionJobId?: string;
  revealJobId?: string;
  prepJobId?: string;
  lockJobId?: string;
  axisOverrides: AxisOverrides;
  format?: SeasonFormat;
  categories?: string[];
  theme?: string;
  // These axes also appear in axisOverrides; kept top-level for backward compat.
  instructions?: string;
  additionalInstructions?: string;
  liveAnswersVisible?: boolean;
  revealResponses?: RevealResponsesMode;
  hint?: TriviaHintConfig;
  judgeLeniency?: JudgeLeniency;
  allTimeRow?: TriviaAllTimeRowMode;
  tagPlayers?: boolean;
  scrollToTop?: boolean;
  disableAfterRound?: boolean;
  perfectRoundsAward?: PerfectRoundsAward;
  includeRevealInQuestions?: TriviaIncludeRevealInQuestions;
  finalRevealSummary?: TriviaFinalRevealSummary;
  tellMeMore?: TriviaTellMeMoreConfig;
  teams?: TeamDef[];
  teamsEnabled?: boolean;
  teamsFinaleIndividuals?: boolean;
  teamsScoring?: TeamsScoringMode;
  answeringType?: TriviaAnsweringType;
  /** Present when the effective teams config is enabled with an empty roster (inert misconfiguration). */
  teamsWarning?: string;
  /** Present when `answeringType: "byTeam"` is set but teams mode is not effectively on (inert). */
  answeringTypeWarning?: string;
  /** Present when live (posted, un-revealed) questions carry a `byTeam` stamp the current config no longer resolves to. */
  answeringTypeDivergence?: { liveByTeamQuestions: number; note: string };
}

export type FindOwnedCronJobsFn = () => Promise<Array<{ id: string; specKey: string }>>;
const defaultFindOwnedCronJobs: FindOwnedCronJobsFn = async () => [];

// The cascade axes (projected from AXIS_KEYS, includes `choices`) plus the non-axis
// workspace fields.
type WorkspaceDefaults = Partial<CascadeAxes> & {
  seasons?: TriviaSeasonsConfig;
  offDays?: OffDay[];
  allTimeRow?: TriviaAllTimeRowMode;
  tagPlayers?: boolean;
  scrollToTop?: boolean;
  perfectRoundsAward?: PerfectRoundsAward;
  includeRevealInQuestions?: TriviaIncludeRevealInQuestions;
  finalRevealSummary?: TriviaFinalRevealSummary;
  tellMeMore?: TriviaTellMeMoreConfig;
  teams?: TeamDef[];
  teamsEnabled?: boolean;
  teamsFinaleIndividuals?: boolean;
  teamsScoring?: TeamsScoringMode;
  answeringType?: TriviaAnsweringType;
};

const DESCRIPTION = `List the trivia games configured in this deployment (data/plugins/trivia/config.json's \`games[]\`), plus the workspace tier of the cascading axis configuration (\`workspaceDefaults\`) AND each entry's per-game \`axisOverrides\`, so admins can audit configuration without reading the file by hand.

By default, disabled games are excluded; pass \`includeDisabled: true\` to surface them too. Each game entry includes \`questionCron\`, \`revealCron\`, \`timezone\`, \`enabled\`, and an \`axisOverrides\` block surfacing the game's per-game cascade tier for EVERY cascading axis (registry-driven — \`answersFormat\`, \`questionType\`, \`promptMedium\`, \`freeformAnswerShape\`, \`contexts\`, \`difficulty\`, \`difficultyRatio\`, \`hint\`, \`judgeLeniency\`, \`choices\`, \`choiceEmojiStyle\`, \`points\`, \`instructions\`, \`additionalInstructions\`, \`liveAnswersVisible\`, \`revealResponses\`). Each axis field is present IF AND ONLY IF the game's entry literally set it. The block is always included on every entry (possibly as \`{}\`). Per-game \`format\` (slot composition), \`categories\` (narrowed pool), \`theme\` (narrative label), \`prepCron\` (opt-in pre-staging schedule), \`lockCron\` (opt-in voting-lock schedule), \`disableAfterRound\` (wind-down-at-round-close lifecycle flag), and \`remindMissedPlayers\` (reminder-before-reveal lifecycle flag) also surface on each entry IF AND ONLY IF set. When \`prepCron\` is set, the entry also includes \`nextPrepFire\`; when \`lockCron\` is set, it includes \`nextLockFire\` — each the epoch ms of that cron's next fire in the game's timezone, so admins can sanity-check the schedule.

Each entry also surfaces the underlying cron job UUIDs — \`questionJobId\`, \`revealJobId\`, (when \`prepCron\` is set) \`prepJobId\`, and (when \`lockCron\` is set) \`lockJobId\` — when the trivia plugin's reconcile has registered the corresponding jobs. Pass these to \`run_scheduled_message_now({id})\` to fire a slot on-demand without a separate \`list_scheduled_messages\` lookup.

\`workspaceDefaults\` carries the workspace-level values for every cascading axis (registry-driven, including \`choices\`) plus the non-axis workspace fields (\`seasons\`, \`offDays\`, \`allTimeRow\`, \`tagPlayers\`, \`scrollToTop\`, …). Same present-iff-set rule.

The cascade tier order is: \`slot → season → game → workspace → built-in default\`. To audit the slot and season tiers, call \`list_seasons\` (its per-entry fields surface season-tier overrides, and \`format.questions[i]\` surface slot-tier overrides). To mutate either game-tier or workspace-tier values, attach the \`trivia:management\` integration and use \`upsert_game\` / \`set_workspace_config\`.

Use this to discover available game slugs to pass as the \`game\` argument to other trivia tools, AND to audit the full cascade for any axis.`;

export function createListGamesTool(
  getGamesFn: GetGamesFn = defaultGetGames,
  getTriviaConfigFn: GetTriviaConfigFn = defaultGetTriviaConfig,
  findOwnedCronJobsFn: FindOwnedCronJobsFn = defaultFindOwnedCronJobs,
  data?: TriviaDataLayer,
) {
  return tool(
    "list_games",
    DESCRIPTION,
    {
      includeDisabled: z
        .boolean()
        .optional()
        .describe("When true, include games whose `enabled: false`. Defaults to false."),
    },
    async (args) => {
      const includeDisabled = args.includeDisabled ?? false;
      const games = getGamesFn();
      const filtered = includeDisabled ? games : games.filter((g) => g.enabled !== false);

      const ownedJobs = await findOwnedCronJobsFn();
      const jobIdBySpecKey = new Map<string, string>();
      for (const j of ownedJobs) {
        jobIdBySpecKey.set(j.specKey, j.id);
      }

      const workspaceCfg = getTriviaConfigFn();

      // Divergence audit (task 3.2): a game whose CURRENT resolved answeringType is
      // individual may still carry live (posted, un-revealed) questions STAMPED
      // "byTeam" — those stay shared-buzzer (the stamp governs), but new fires differ.
      // Needs a per-game questions read, so it runs only when `data` is provided.
      const divergenceByGame = new Map<string, number>();
      if (data !== undefined) {
        await Promise.all(
          filtered.map(async (g) => {
            if (resolveTeamsConfig(null, g, workspaceCfg).answeringType === "byTeam") return;
            const questions = await data.forGame(g.name).loadQuestions();
            const liveByTeam = questions.filter(
              (q) =>
                q.answeringType === "byTeam" &&
                q.postedAt !== undefined &&
                q.processedAt === undefined &&
                q.invalidated !== true,
            ).length;
            if (liveByTeam > 0) divergenceByGame.set(g.name, liveByTeam);
          }),
        );
      }

      const entries: ListGamesEntry[] = filtered.map((g) => {
        const axisOverrides: AxisOverrides = {};
        for (const key of AXIS_KEYS) copyAxisIfSet(axisOverrides, g, key);

        // Season-tier teams overrides are surfaced by list_seasons; this warning
        // audits the game+workspace tiers, which is what an admin staging a
        // roster before enabling can act on without a per-game seasons read.
        const effectiveTeams = resolveTeamsConfig(null, g, workspaceCfg);

        // Next-fire epoch ms for the optional prep / lock crons. See `nextFireMs`:
        // an absent or (defensively) unparseable cron yields `undefined`, omitting
        // the field rather than blowing up the entire list.
        const nextPrepFire = nextFireMs(g.prepCron, g.timezone);
        const nextLockFire = nextFireMs(g.lockCron, g.timezone);

        const questionJobId = jobIdBySpecKey.get(`${g.name}:question`);
        const revealJobId = jobIdBySpecKey.get(`${g.name}:reveal`);
        const prepJobId =
          g.prepCron !== undefined ? jobIdBySpecKey.get(`${g.name}:prep`) : undefined;
        const lockJobId =
          g.lockCron !== undefined ? jobIdBySpecKey.get(`${g.name}:lock`) : undefined;

        return {
          name: g.name,
          channel: g.channel,
          timezone: g.timezone,
          enabled: g.enabled !== false,
          questionCron: g.questionCron,
          revealCron: g.revealCron,
          ...(g.prepCron !== undefined ? { prepCron: g.prepCron } : {}),
          ...(nextPrepFire !== undefined ? { nextPrepFire } : {}),
          ...(g.lockCron !== undefined ? { lockCron: g.lockCron } : {}),
          ...(nextLockFire !== undefined ? { nextLockFire } : {}),
          ...(questionJobId !== undefined ? { questionJobId } : {}),
          ...(revealJobId !== undefined ? { revealJobId } : {}),
          ...(prepJobId !== undefined ? { prepJobId } : {}),
          ...(lockJobId !== undefined ? { lockJobId } : {}),
          axisOverrides,
          ...(g.format !== undefined ? { format: g.format } : {}),
          ...(g.categories !== undefined ? { categories: g.categories } : {}),
          ...(g.theme !== undefined ? { theme: g.theme } : {}),
          // Kept top-level for backward compat; also present in axisOverrides now.
          ...(g.instructions !== undefined ? { instructions: g.instructions } : {}),
          ...(g.additionalInstructions !== undefined
            ? { additionalInstructions: g.additionalInstructions }
            : {}),
          ...(g.liveAnswersVisible !== undefined
            ? { liveAnswersVisible: g.liveAnswersVisible }
            : {}),
          ...(g.revealResponses !== undefined ? { revealResponses: g.revealResponses } : {}),
          ...(g.hint !== undefined ? { hint: g.hint } : {}),
          ...(g.allTimeRow !== undefined ? { allTimeRow: g.allTimeRow } : {}),
          ...(g.tagPlayers !== undefined ? { tagPlayers: g.tagPlayers } : {}),
          ...(g.disableAfterRound !== undefined ? { disableAfterRound: g.disableAfterRound } : {}),
          ...(g.scrollToTop !== undefined ? { scrollToTop: g.scrollToTop } : {}),
          ...(g.perfectRoundsAward !== undefined
            ? { perfectRoundsAward: g.perfectRoundsAward }
            : {}),
          ...(g.includeRevealInQuestions !== undefined
            ? { includeRevealInQuestions: g.includeRevealInQuestions }
            : {}),
          ...(g.finalRevealSummary !== undefined
            ? { finalRevealSummary: g.finalRevealSummary }
            : {}),
          ...(g.tellMeMore !== undefined ? { tellMeMore: g.tellMeMore } : {}),
          ...(g.judgeLeniency !== undefined ? { judgeLeniency: g.judgeLeniency } : {}),
          ...(g.teams !== undefined ? { teams: g.teams } : {}),
          ...(g.teamsEnabled !== undefined ? { teamsEnabled: g.teamsEnabled } : {}),
          ...(g.teamsFinaleIndividuals !== undefined
            ? { teamsFinaleIndividuals: g.teamsFinaleIndividuals }
            : {}),
          ...(g.teamsScoring !== undefined ? { teamsScoring: g.teamsScoring } : {}),
          ...(g.answeringType !== undefined ? { answeringType: g.answeringType } : {}),
          ...(effectiveTeams.inertEnabled
            ? {
                teamsWarning:
                  "teamsEnabled resolves to true but the effective roster is empty — teams mode is INERT (individual play). Define a roster via upsert_game/upsert_season/set_workspace_config `teams`, or clear teamsEnabled.",
              }
            : {}),
          ...(effectiveTeams.inertAnsweringType
            ? {
                answeringTypeWarning:
                  'answeringType resolves to "byTeam" but teams mode is not effectively on (disabled or empty roster) — shared-buzzer is INERT (individual play). Enable teams with a non-empty roster, or clear answeringType.',
              }
            : {}),
          ...(divergenceByGame.get(g.name) !== undefined
            ? {
                answeringTypeDivergence: {
                  liveByTeamQuestions: divergenceByGame.get(g.name) ?? 0,
                  note: "Live (posted, un-revealed) questions here are stamped byTeam and STAY shared-buzzer (the stamp governs), but the current config resolves to individual — new fires will be individual.",
                },
              }
            : {}),
        };
      });

      const triviaCfg = workspaceCfg;
      const workspaceDefaults: WorkspaceDefaults = {};
      if (triviaCfg) {
        for (const key of AXIS_KEYS) copyAxisIfSet(workspaceDefaults, triviaCfg, key);
        // Non-axis workspace fields kept alongside the cascade axes.
        if (triviaCfg.seasons !== undefined) workspaceDefaults.seasons = triviaCfg.seasons;
        if (triviaCfg.offDays !== undefined) workspaceDefaults.offDays = triviaCfg.offDays;
        if (triviaCfg.allTimeRow !== undefined) workspaceDefaults.allTimeRow = triviaCfg.allTimeRow;
        if (triviaCfg.tagPlayers !== undefined) workspaceDefaults.tagPlayers = triviaCfg.tagPlayers;
        if (triviaCfg.scrollToTop !== undefined)
          workspaceDefaults.scrollToTop = triviaCfg.scrollToTop;
        if (triviaCfg.perfectRoundsAward !== undefined)
          workspaceDefaults.perfectRoundsAward = triviaCfg.perfectRoundsAward;
        if (triviaCfg.includeRevealInQuestions !== undefined)
          workspaceDefaults.includeRevealInQuestions = triviaCfg.includeRevealInQuestions;
        if (triviaCfg.finalRevealSummary !== undefined)
          workspaceDefaults.finalRevealSummary = triviaCfg.finalRevealSummary;
        if (triviaCfg.tellMeMore !== undefined) workspaceDefaults.tellMeMore = triviaCfg.tellMeMore;
        if (triviaCfg.teams !== undefined) workspaceDefaults.teams = triviaCfg.teams;
        if (triviaCfg.teamsEnabled !== undefined)
          workspaceDefaults.teamsEnabled = triviaCfg.teamsEnabled;
        if (triviaCfg.teamsFinaleIndividuals !== undefined)
          workspaceDefaults.teamsFinaleIndividuals = triviaCfg.teamsFinaleIndividuals;
        if (triviaCfg.teamsScoring !== undefined)
          workspaceDefaults.teamsScoring = triviaCfg.teamsScoring;
        if (triviaCfg.answeringType !== undefined)
          workspaceDefaults.answeringType = triviaCfg.answeringType;
      }

      return textResult({ games: entries, workspaceDefaults, total: entries.length });
    },
  );
}
