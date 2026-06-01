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
  TriviaAnswersFormatWeights,
  TriviaQuestionTypeWeights,
  TriviaFreeformAnswerShapeWeights,
  TriviaContextEntry,
  TriviaDifficultyConfig,
  TriviaDifficultyRatioConfig,
  TriviaChoicesConfig,
  TriviaHintConfig,
  TriviaAllTimeRowMode,
  TriviaSeasonsConfig,
  OffDay,
} from "../../core/configTypes.js";

interface AxisOverrides {
  answersFormat?: TriviaAnswersFormatWeights;
  questionType?: TriviaQuestionTypeWeights;
  freeformAnswerShape?: TriviaFreeformAnswerShapeWeights;
  contexts?: TriviaContextEntry[];
  difficulty?: TriviaDifficultyConfig;
  difficultyRatio?: TriviaDifficultyRatioConfig;
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
  questionJobId?: string;
  revealJobId?: string;
  prepJobId?: string;
  axisOverrides: AxisOverrides;
  format?: SeasonFormat;
  categories?: string[];
  theme?: string;
  instructions?: string;
  additionalInstructions?: string;
  liveAnswersVisible?: boolean;
  revealResponses?: "no" | "just-winners" | "just-correctness" | "yes";
  hint?: TriviaHintConfig;
  allTimeRow?: TriviaAllTimeRowMode;
}

export type FindOwnedCronJobsFn = () => Promise<Array<{ id: string; specKey: string }>>;
const defaultFindOwnedCronJobs: FindOwnedCronJobsFn = async () => [];

interface WorkspaceDefaults {
  answersFormat?: TriviaAnswersFormatWeights;
  questionType?: TriviaQuestionTypeWeights;
  freeformAnswerShape?: TriviaFreeformAnswerShapeWeights;
  contexts?: TriviaContextEntry[];
  difficulty?: TriviaDifficultyConfig;
  difficultyRatio?: TriviaDifficultyRatioConfig;
  choices?: TriviaChoicesConfig;
  seasons?: TriviaSeasonsConfig;
  offDays?: OffDay[];
  instructions?: string;
  additionalInstructions?: string;
  hint?: TriviaHintConfig;
  allTimeRow?: TriviaAllTimeRowMode;
}

const DESCRIPTION = `List the trivia games configured in this deployment (data/plugins/trivia/config.json's \`games[]\`), plus the workspace tier of the cascading axis configuration (\`workspaceDefaults\`) AND each entry's per-game \`axisOverrides\`, so admins can audit configuration without reading the file by hand.

By default, disabled games are excluded; pass \`includeDisabled: true\` to surface them too. Each game entry includes \`questionCron\`, \`revealCron\`, \`timezone\`, \`enabled\`, and an \`axisOverrides\` block surfacing the game's per-game cascade tier (\`answersFormat\`, \`questionType\`, \`freeformAnswerShape\`, \`contexts\`, \`difficulty\`, \`difficultyRatio\`). Each axis field is present IF AND ONLY IF the game's entry literally set it. The block is always included on every entry (possibly as \`{}\`). Per-game \`format\` (slot composition), \`categories\` (narrowed pool), \`theme\` (narrative label), and \`prepCron\` (opt-in pre-staging schedule) also surface on each entry IF AND ONLY IF set. When \`prepCron\` is set, the entry also includes \`nextPrepFire\` (epoch ms of the prep cron's next fire in the game's timezone) so admins can sanity-check the schedule.

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
        const axisOverrides: AxisOverrides = {
          ...(g.answersFormat !== undefined ? { answersFormat: g.answersFormat } : {}),
          ...(g.questionType !== undefined ? { questionType: g.questionType } : {}),
          ...(g.freeformAnswerShape !== undefined
            ? { freeformAnswerShape: g.freeformAnswerShape }
            : {}),
          ...(g.contexts !== undefined ? { contexts: g.contexts } : {}),
          ...(g.difficulty !== undefined ? { difficulty: g.difficulty } : {}),
          ...(g.difficultyRatio !== undefined ? { difficultyRatio: g.difficultyRatio } : {}),
        };

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
        };
      });

      const triviaCfg = getTriviaConfigFn();
      const workspaceDefaults: WorkspaceDefaults = {
        ...(triviaCfg?.answersFormat !== undefined
          ? { answersFormat: triviaCfg.answersFormat }
          : {}),
        ...(triviaCfg?.questionType !== undefined ? { questionType: triviaCfg.questionType } : {}),
        ...(triviaCfg?.freeformAnswerShape !== undefined
          ? { freeformAnswerShape: triviaCfg.freeformAnswerShape }
          : {}),
        ...(triviaCfg?.contexts !== undefined ? { contexts: triviaCfg.contexts } : {}),
        ...(triviaCfg?.difficulty !== undefined ? { difficulty: triviaCfg.difficulty } : {}),
        ...(triviaCfg?.difficultyRatio !== undefined
          ? { difficultyRatio: triviaCfg.difficultyRatio }
          : {}),
        ...(triviaCfg?.choices !== undefined ? { choices: triviaCfg.choices } : {}),
        ...(triviaCfg?.seasons !== undefined ? { seasons: triviaCfg.seasons } : {}),
        ...(triviaCfg?.offDays !== undefined ? { offDays: triviaCfg.offDays } : {}),
        ...(triviaCfg?.instructions !== undefined ? { instructions: triviaCfg.instructions } : {}),
        ...(triviaCfg?.additionalInstructions !== undefined
          ? { additionalInstructions: triviaCfg.additionalInstructions }
          : {}),
        ...(triviaCfg?.hint !== undefined ? { hint: triviaCfg.hint } : {}),
        ...(triviaCfg?.allTimeRow !== undefined ? { allTimeRow: triviaCfg.allTimeRow } : {}),
      };

      return textResult({ games: entries, workspaceDefaults, total: entries.length });
    },
  );
}
