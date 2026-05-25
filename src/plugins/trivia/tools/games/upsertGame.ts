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
import type { JsonObject, JsonValue, TriviaConfig, TriviaGame } from "../../core/configTypes.js";
import { parseTriviaAxisBag } from "../../core/configParsers/axes.js";
import type { ParseIssue } from "../../core/configParsers/axes.js";

const TRIVIA_GAME_NAME_RE = /^[a-z0-9-]+$/;
const CHANNEL_RE = /^[CGD][A-Z0-9_]+$/;

const axisBagSchema = {
  answersFormat: z
    .object({
      boolean: z.number().int().nonnegative().optional(),
      choice: z.number().int().nonnegative().optional(),
      freeform: z.number().int().nonnegative().optional(),
    })
    .nullable()
    .optional()
    .describe(
      "Per-game answer-format weights. On UPDATE: explicit null clears the field. Cascade slot → season → game → workspace → default.",
    ),
  questionType: z
    .object({
      fact: z.number().int().nonnegative().optional(),
      topical: z.number().int().nonnegative().optional(),
    })
    .nullable()
    .optional()
    .describe("Per-game fact-vs-topical weights. Explicit null clears."),
  freeformAnswerShape: z
    .object({
      name: z.number().int().nonnegative().optional(),
      place: z.number().int().nonnegative().optional(),
      phrase: z.number().int().nonnegative().optional(),
      title: z.number().int().nonnegative().optional(),
      date: z.number().int().nonnegative().optional(),
      number: z.number().int().nonnegative().optional(),
      other: z.number().int().nonnegative().optional(),
    })
    .nullable()
    .optional()
    .describe("Per-game freeform-shape weights. Explicit null clears."),
  contexts: z
    .array(z.object({ name: z.string(), weight: z.number().positive().optional() }))
    .nullable()
    .optional()
    .describe("Per-game lens list. Explicit null clears."),
  difficulty: z
    .object({
      boolean: z
        .object({
          easy: z
            .tuple([z.number().int().min(1).max(10), z.number().int().min(1).max(10)])
            .optional(),
          medium: z
            .tuple([z.number().int().min(1).max(10), z.number().int().min(1).max(10)])
            .optional(),
          hard: z
            .tuple([z.number().int().min(1).max(10), z.number().int().min(1).max(10)])
            .optional(),
          minimumThreshold: z.number().int().min(1).max(10).optional(),
        })
        .optional(),
      choice: z
        .object({
          easy: z
            .tuple([z.number().int().min(1).max(10), z.number().int().min(1).max(10)])
            .optional(),
          medium: z
            .tuple([z.number().int().min(1).max(10), z.number().int().min(1).max(10)])
            .optional(),
          hard: z
            .tuple([z.number().int().min(1).max(10), z.number().int().min(1).max(10)])
            .optional(),
          minimumThreshold: z.number().int().min(1).max(10).optional(),
        })
        .optional(),
      freeform: z
        .object({
          easy: z
            .tuple([z.number().int().min(1).max(10), z.number().int().min(1).max(10)])
            .optional(),
          medium: z
            .tuple([z.number().int().min(1).max(10), z.number().int().min(1).max(10)])
            .optional(),
          hard: z
            .tuple([z.number().int().min(1).max(10), z.number().int().min(1).max(10)])
            .optional(),
          minimumThreshold: z.number().int().min(1).max(10).optional(),
        })
        .optional(),
    })
    .nullable()
    .optional()
    .describe(
      "Per-game per-format difficulty overrides. Fields cascade per sub-field — overriding just freeform.hard is fine. Explicit null clears the whole game-tier difficulty.",
    ),
};

export function createUpsertGameTool(getGamesFn: GetGamesFn = defaultGetGames) {
  return tool(
    "upsert_game",
    "Create OR update a trivia game in data/plugins/trivia/config.json. CREATE branch: triggered when the named game doesn't exist yet — requires channel, questionCron, revealCron, timezone; enabled defaults to true. UPDATE branch: triggered when the game exists — every scheduling field is omit-to-keep (only update what you pass), every axis field uses null-to-clear / omit-to-keep semantics. Game name is immutable — to rename, delete + upsert. Axis fields participate in the cascade slot → season → game → workspace → built-in default. For workspace-tier changes use set_workspace_config. Mutates the plugin config file directly — no confirm/approval flow.",
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

      const issues: ParseIssue[] = [];
      let parsed: Partial<TriviaGame> = {};
      if (Object.keys(axisInput).length > 0) {
        const result = parseTriviaAxisBag(axisInput, `upsert_game(${args.name})`);
        issues.push(...result.issues);
        parsed = result.axes;
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
      };
      if (args.answersFormat === null) delete mergedAxes.answersFormat;
      else if (parsed.answersFormat !== undefined) mergedAxes.answersFormat = parsed.answersFormat;
      if (args.questionType === null) delete mergedAxes.questionType;
      else if (parsed.questionType !== undefined) mergedAxes.questionType = parsed.questionType;
      if (args.freeformAnswerShape === null) delete mergedAxes.freeformAnswerShape;
      else if (parsed.freeformAnswerShape !== undefined)
        mergedAxes.freeformAnswerShape = parsed.freeformAnswerShape;
      if (args.contexts === null) delete mergedAxes.contexts;
      else if (parsed.contexts !== undefined) mergedAxes.contexts = parsed.contexts;
      if (args.difficulty === null) delete mergedAxes.difficulty;
      else if (parsed.difficulty !== undefined) mergedAxes.difficulty = parsed.difficulty;

      const enabled = args.enabled ?? existing?.enabled ?? true;

      const next: TriviaGame = {
        name: args.name,
        channel,
        questionCron,
        revealCron,
        timezone,
        enabled,
        ...mergedAxes,
      };
      if (isCreate) games.push(next);
      else games[existingIndex] = next;

      const currentConfig: TriviaConfig = loadTriviaConfig() ?? {};
      const nextConfig: TriviaConfig = { ...currentConfig, games };
      await saveTriviaConfig(nextConfig);

      const hasAxisOverrides = Object.keys(mergedAxes).length > 0;
      return textResult({
        name: args.name,
        action: isCreate ? "created" : "updated",
        enabled,
        hasAxisOverrides,
      });
    },
  );
}
