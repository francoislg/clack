import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../tools/helpers.js";
import { loadTriviaConfig, saveTriviaConfig } from "../../core/configBridge.js";
import type { JsonObject, JsonValue, OffDay, TriviaConfig } from "../../core/configTypes.js";
import {
  parseTriviaAxisBag,
  validateTriviaChoicesConfig,
  type ParseIssue,
} from "../../core/configParsers/axes.js";
import { parseOffDays } from "../../core/configParsers/games.js";

export function createSetWorkspaceConfigTool() {
  return tool(
    "set_workspace_config",
    "Update workspace-tier fields on data/plugins/trivia/config.json. Pass any subset of fields you want to change; omit to keep, pass null to clear from the workspace tier. Validates each field with the same parsers used at file-load time. Affects every game globally — for per-game overrides use upsert_game's axis fields.",
    {
      answersFormat: z
        .object({
          boolean: z.number().int().nonnegative().optional(),
          choice: z.number().int().nonnegative().optional(),
          freeform: z.number().int().nonnegative().optional(),
        })
        .nullable()
        .optional()
        .describe("Workspace default answersFormat weights. null clears."),
      questionType: z
        .object({
          fact: z.number().int().nonnegative().optional(),
          topical: z.number().int().nonnegative().optional(),
        })
        .nullable()
        .optional()
        .describe("Workspace default questionType weights. null clears."),
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
        .describe("Workspace default freeform-shape weights. null clears."),
      contexts: z
        .array(z.object({ name: z.string(), weight: z.number().positive().optional() }))
        .nullable()
        .optional()
        .describe("Workspace contexts list. null clears."),
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
        .describe("Workspace difficulty ranges per format. null clears."),
      choices: z
        .object({ min: z.number().int().min(2).max(4), max: z.number().int().min(2).max(4) })
        .nullable()
        .optional()
        .describe("Choice question option-count bounds. null clears (falls back to {4,4})."),
      offDays: z
        .array(z.object({ date: z.string(), label: z.string() }))
        .nullable()
        .optional()
        .describe(
          "Off-days (YYYY-MM-DD or recurring MM-DD format) shared across all games. null clears.",
        ),
      seasons: z
        .object({ enabled: z.boolean(), prompt: z.string() })
        .nullable()
        .optional()
        .describe(
          "Seasons feature toggle + author prompt. null clears (disables the feature for the workspace).",
        ),
    },
    async (args) => {
      // Detect "no fields to update" — every field undefined.
      const provided = Object.entries(args).filter(([, v]) => v !== undefined);
      if (provided.length === 0) {
        return errorResult(
          "no fields to update — pass at least one axis / choices / offDays / seasons value.",
        );
      }

      const current: TriviaConfig = loadTriviaConfig() ?? {};
      const next: TriviaConfig = { ...current };
      const updatedFields: string[] = [];

      // Validate + apply axis-bag fields via the shared parser.
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
      if (Object.keys(axisInput).length > 0) {
        const r = parseTriviaAxisBag(axisInput, "set_workspace_config");
        issues.push(...r.issues);
        if (r.axes.answersFormat !== undefined) {
          next.answersFormat = r.axes.answersFormat;
          updatedFields.push("answersFormat");
        }
        if (r.axes.questionType !== undefined) {
          next.questionType = r.axes.questionType;
          updatedFields.push("questionType");
        }
        if (r.axes.freeformAnswerShape !== undefined) {
          next.freeformAnswerShape = r.axes.freeformAnswerShape;
          updatedFields.push("freeformAnswerShape");
        }
        if (r.axes.contexts !== undefined) {
          next.contexts = r.axes.contexts;
          updatedFields.push("contexts");
        }
        if (r.axes.difficulty !== undefined) {
          next.difficulty = r.axes.difficulty;
          updatedFields.push("difficulty");
        }
      }

      // Apply null-clears for axis fields.
      if (args.answersFormat === null) {
        delete next.answersFormat;
        updatedFields.push("answersFormat (cleared)");
      }
      if (args.questionType === null) {
        delete next.questionType;
        updatedFields.push("questionType (cleared)");
      }
      if (args.freeformAnswerShape === null) {
        delete next.freeformAnswerShape;
        updatedFields.push("freeformAnswerShape (cleared)");
      }
      if (args.contexts === null) {
        delete next.contexts;
        updatedFields.push("contexts (cleared)");
      }
      if (args.difficulty === null) {
        delete next.difficulty;
        updatedFields.push("difficulty (cleared)");
      }

      // choices: validate + apply
      if (args.choices === null) {
        delete next.choices;
        updatedFields.push("choices (cleared)");
      } else if (args.choices !== undefined) {
        const r = validateTriviaChoicesConfig(args.choices, "set_workspace_config.choices");
        if (!r.ok) issues.push({ field: "choices", error: r.error });
        else {
          next.choices = r.value;
          updatedFields.push("choices");
        }
      }

      // offDays: validate + apply
      if (args.offDays === null) {
        delete next.offDays;
        updatedFields.push("offDays (cleared)");
      } else if (args.offDays !== undefined) {
        const offDaysJson: JsonValue = args.offDays.map((d) => ({
          date: d.date,
          label: d.label,
        }));
        const r = parseOffDays(offDaysJson);
        issues.push(...r.issues);
        const valid: OffDay[] = r.offDays ?? [];
        // Reject if the parser dropped any entries — strict mode for tool input.
        if (valid.length !== args.offDays.length) {
          return errorResult(
            `Some offDays entries are invalid: ${r.issues.map((i) => `${i.field}: ${i.error}`).join("; ")}`,
          );
        }
        next.offDays = valid;
        updatedFields.push("offDays");
      }

      // seasons: tool-side validation (enabled+empty-prompt rejected)
      if (args.seasons === null) {
        delete next.seasons;
        updatedFields.push("seasons (cleared)");
      } else if (args.seasons !== undefined) {
        if (args.seasons.enabled && args.seasons.prompt.trim().length === 0) {
          return errorResult(
            "seasons.enabled is true but seasons.prompt is empty — provide a non-empty prompt or set enabled: false.",
          );
        }
        next.seasons = { enabled: args.seasons.enabled, prompt: args.seasons.prompt };
        updatedFields.push("seasons");
      }

      if (issues.length > 0) {
        return errorResult(issues.map((i) => `${i.field}: ${i.error}`).join("; "));
      }

      await saveTriviaConfig(next);

      return textResult({ action: "updated", updatedFields });
    },
  );
}
