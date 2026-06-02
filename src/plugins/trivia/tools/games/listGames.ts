import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { CronExpressionParser } from "cron-parser";
import { textResult } from "../../../../tools/helpers.js";
import {
  defaultGetGames,
  defaultGetTriviaConfig,
  type GetGamesFn,
  type GetTriviaConfigFn,
} from "../../core/configBridge.js";
import type {
  SeasonFormat,
  TriviaChoicesConfig,
  TriviaAllTimeRowMode,
  TriviaSeasonsConfig,
  TriviaHintConfig,
  JudgeLeniency,
  RevealResponsesMode,
  OffDay,
} from "../../core/configTypes.js";
import type { CascadeAxes } from "../../core/cascadeAxes.js";
import { AXIS_KEYS, copyAxisIfSet } from "../../domain/resolveCascade.js";

/**
 * Per-game cascade-axis overrides. Projected from `AXIS_KEYS` (the registry's axis set),
 * so every cascading axis — including `promptMedium`, `liveAnswersVisible`,
 * `revealResponses`, `instructions`, `additionalInstructions` — surfaces automatically;
 * adding a future axis to the registry surfaces it here with no edit.
 */
type AxisOverrides = Partial<CascadeAxes>;

interface ListGamesEntry {
  name: string;
  channel: string;
  timezone: string;
  enabled: boolean;
  questionCron: string;
  revealCron: string;
  prepCron?: string;
  nextPrepFire?: number;
  questionJobId?: string;
  revealJobId?: string;
  prepJobId?: string;
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
}

export type FindOwnedCronJobsFn = () => Promise<Array<{ id: string; specKey: string }>>;
const defaultFindOwnedCronJobs: FindOwnedCronJobsFn = async () => [];

// The 13 cascade axes (projected from AXIS_KEYS) plus the non-axis workspace fields.
type WorkspaceDefaults = Partial<CascadeAxes> & {
  choices?: TriviaChoicesConfig;
  seasons?: TriviaSeasonsConfig;
  offDays?: OffDay[];
  allTimeRow?: TriviaAllTimeRowMode;
};

const DESCRIPTION = `List the trivia games configured in this deployment (data/plugins/trivia/config.json's \`games[]\`), plus the workspace tier of the cascading axis configuration (\`workspaceDefaults\`) AND each entry's per-game \`axisOverrides\`, so admins can audit configuration without reading the file by hand.

By default, disabled games are excluded; pass \`includeDisabled: true\` to surface them too. Each game entry includes \`questionCron\`, \`revealCron\`, \`timezone\`, \`enabled\`, and an \`axisOverrides\` block surfacing the game's per-game cascade tier for EVERY cascading axis (registry-driven — \`answersFormat\`, \`questionType\`, \`promptMedium\`, \`freeformAnswerShape\`, \`contexts\`, \`difficulty\`, \`difficultyRatio\`, \`hint\`, \`judgeLeniency\`, \`instructions\`, \`additionalInstructions\`, \`liveAnswersVisible\`, \`revealResponses\`). Each axis field is present IF AND ONLY IF the game's entry literally set it. The block is always included on every entry (possibly as \`{}\`). Per-game \`format\` (slot composition), \`categories\` (narrowed pool), \`theme\` (narrative label), and \`prepCron\` (opt-in pre-staging schedule) also surface on each entry IF AND ONLY IF set. When \`prepCron\` is set, the entry also includes \`nextPrepFire\` (epoch ms of the prep cron's next fire in the game's timezone) so admins can sanity-check the schedule.

Each entry also surfaces the underlying cron job UUIDs — \`questionJobId\`, \`revealJobId\`, and (when \`prepCron\` is set) \`prepJobId\` — when the trivia plugin's reconcile has registered the corresponding jobs. Pass these to \`run_scheduled_message_now({id})\` to fire a slot on-demand without a separate \`list_scheduled_messages\` lookup.

\`workspaceDefaults\` carries the workspace-level values for every axis (the 5 cascading axes plus \`choices\`, \`seasons\`, \`offDays\`). Same present-iff-set rule.

The cascade tier order is: \`slot → season → game → workspace → built-in default\`. To audit the slot and season tiers, call \`list_seasons\` (its per-entry fields surface season-tier overrides, and \`format.questions[i]\` surface slot-tier overrides). To mutate either game-tier or workspace-tier values, attach the \`trivia:management\` integration and use \`upsert_game\` / \`set_workspace_config\`.

Use this to discover available game slugs to pass as the \`game\` argument to other trivia tools, AND to audit the full cascade for any axis.`;

export function createListGamesTool(
  getGamesFn: GetGamesFn = defaultGetGames,
  getTriviaConfigFn: GetTriviaConfigFn = defaultGetTriviaConfig,
  findOwnedCronJobsFn: FindOwnedCronJobsFn = defaultFindOwnedCronJobs,
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

      const entries: ListGamesEntry[] = filtered.map((g) => {
        const axisOverrides: AxisOverrides = {};
        for (const key of AXIS_KEYS) copyAxisIfSet(axisOverrides, g, key);

        // Compute next-prep-fire epoch ms only when prepCron is set. Wrapped in
        // try/catch so a malformed cron expression (shouldn't reach here — the
        // parser validates at config-load time — but defensive) silently omits
        // the field rather than blowing up the entire list.
        let nextPrepFire: number | undefined;
        if (g.prepCron !== undefined) {
          try {
            nextPrepFire = CronExpressionParser.parse(g.prepCron, { tz: g.timezone })
              .next()
              .toDate()
              .getTime();
          } catch {
            nextPrepFire = undefined;
          }
        }

        const questionJobId = jobIdBySpecKey.get(`${g.name}:question`);
        const revealJobId = jobIdBySpecKey.get(`${g.name}:reveal`);
        const prepJobId =
          g.prepCron !== undefined ? jobIdBySpecKey.get(`${g.name}:prep`) : undefined;

        return {
          name: g.name,
          channel: g.channel,
          timezone: g.timezone,
          enabled: g.enabled !== false,
          questionCron: g.questionCron,
          revealCron: g.revealCron,
          ...(g.prepCron !== undefined ? { prepCron: g.prepCron } : {}),
          ...(nextPrepFire !== undefined ? { nextPrepFire } : {}),
          ...(questionJobId !== undefined ? { questionJobId } : {}),
          ...(revealJobId !== undefined ? { revealJobId } : {}),
          ...(prepJobId !== undefined ? { prepJobId } : {}),
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
          ...(g.judgeLeniency !== undefined ? { judgeLeniency: g.judgeLeniency } : {}),
        };
      });

      const triviaCfg = getTriviaConfigFn();
      const workspaceDefaults: WorkspaceDefaults = {};
      if (triviaCfg) {
        for (const key of AXIS_KEYS) copyAxisIfSet(workspaceDefaults, triviaCfg, key);
        // Non-axis workspace fields kept alongside the cascade axes.
        if (triviaCfg.choices !== undefined) workspaceDefaults.choices = triviaCfg.choices;
        if (triviaCfg.seasons !== undefined) workspaceDefaults.seasons = triviaCfg.seasons;
        if (triviaCfg.offDays !== undefined) workspaceDefaults.offDays = triviaCfg.offDays;
        if (triviaCfg.allTimeRow !== undefined) workspaceDefaults.allTimeRow = triviaCfg.allTimeRow;
      }

      return textResult({ games: entries, workspaceDefaults, total: entries.length });
    },
  );
}
