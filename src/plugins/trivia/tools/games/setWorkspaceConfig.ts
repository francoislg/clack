import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../tools/helpers.js";
import { loadTriviaConfig, saveTriviaConfig } from "../../core/configBridge.js";
import type {
  JsonObject,
  JsonValue,
  OffDay,
  RevealResponsesMode,
  TriviaConfig,
} from "../../core/configTypes.js";
import {
  REVEAL_RESPONSES_VALUES,
  answersFormatZod,
  contextsZod,
  difficultyZod,
  freeformAnswerShapeZod,
  parseTriviaAxisBag,
  questionTypeZod,
  triviaDifficultyRatioZod,
  triviaHintZod,
  validateHintConfig,
  validateTriviaChoicesConfig,
  type ParseIssue,
} from "../../core/configParsers/axes.js";
import { parseOffDays } from "../../core/configParsers/games.js";
import {
  normalizeAdditionalInstructions,
  normalizeInstructions,
  triviaAdditionalInstructionsZod,
  triviaInstructionsZod,
} from "../../core/configParsers/format.js";

export function createSetWorkspaceConfigTool() {
  return tool(
    "set_workspace_config",
    "Update workspace-tier fields on data/plugins/trivia/config.json. Pass any subset of fields you want to change; omit to keep, pass null to clear from the workspace tier. Validates each field with the same parsers used at file-load time. Affects every game globally — for per-game overrides use upsert_game's axis fields.",
    {
      answersFormat: answersFormatZod
        .nullable()
        .optional()
        .describe("Workspace default answersFormat weights. null clears."),
      questionType: questionTypeZod
        .nullable()
        .optional()
        .describe("Workspace default questionType weights. null clears."),
      freeformAnswerShape: freeformAnswerShapeZod
        .nullable()
        .optional()
        .describe("Workspace default freeform-shape weights. null clears."),
      contexts: contextsZod.nullable().optional().describe("Workspace contexts list. null clears."),
      difficulty: difficultyZod
        .nullable()
        .optional()
        .describe("Workspace difficulty ranges per format. null clears."),
      difficultyRatio: triviaDifficultyRatioZod
        .nullable()
        .optional()
        .describe(
          "Workspace difficulty-bucket-roll ratio per format. Each format key carries { easy, medium, hard } non-negative integer weights (at least one strictly positive). Defaults to { easy: 3, medium: 6, hard: 1 } for boolean/choice and { easy: 5, medium: 4, hard: 1 } for freeform when absent. null clears.",
        ),
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
      liveAnswersVisible: z
        .boolean()
        .nullable()
        .optional()
        .describe(
          "Workspace default for the live-roster-footer visibility axis. true (default) reveals each answerer's pick in the live footer; false shows names only. null clears.",
        ),
      revealResponses: z
        .enum(REVEAL_RESPONSES_VALUES as readonly [RevealResponsesMode, ...RevealResponsesMode[]])
        .nullable()
        .optional()
        .describe(
          'Workspace default for the reveal-time participation disclosure axis. "yes" (default) renders full named voter buckets; "just-correctness" hides freeform answer text; "just-winners" names only the correct voters and reduces missers to anonymous counts; "no" hides per-user buckets entirely. null clears.',
        ),
      instructions: triviaInstructionsZod
        .nullable()
        .optional()
        .describe(
          'Workspace tier of the replace-cascade `instructions` axis (e.g. "Be funny and concise."). When set, lower tiers may override it; cascade resolves to the highest-precedence non-empty value walking slot → season → game → workspace. Surfaced verbatim to Claude via the `get_ideas` and `process_reveal_answers` payloads — not injected into any other prompt. null clears.',
        ),
      additionalInstructions: triviaAdditionalInstructionsZod
        .nullable()
        .optional()
        .describe(
          'Workspace tier of the cumulative-cascade `additionalInstructions` axis (e.g. "Avoid politics."). Every non-empty tier stacks — workspace + game + season + slot all apply, concatenated tier-labeled. Surfaced verbatim to Claude via the `get_ideas` and `process_reveal_answers` payloads. null clears this tier.',
        ),
      hint: triviaHintZod
        .nullable()
        .optional()
        .describe(
          'Workspace tier of the hint axis. Object shape `{ mode: "none" | "button" | "inline", minDifficulty?: "easy" | "medium" | "hard" }`. Cascade: `slot → season → game → workspace → { mode: "none" }`. Whole-object replace per tier. `button` is per-player opt-in safety net; `inline` is a room-wide difficulty floor adjustment — pick deliberately. null clears.',
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
      setAxis("difficultyRatio", args.difficultyRatio ?? undefined);

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
        if (r.axes.difficultyRatio !== undefined) {
          next.difficultyRatio = r.axes.difficultyRatio;
          updatedFields.push("difficultyRatio");
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
      if (args.difficultyRatio === null) {
        delete next.difficultyRatio;
        updatedFields.push("difficultyRatio (cleared)");
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

      // liveAnswersVisible: apply or clear.
      if (args.liveAnswersVisible === null) {
        delete next.liveAnswersVisible;
        updatedFields.push("liveAnswersVisible (cleared)");
      } else if (args.liveAnswersVisible !== undefined) {
        next.liveAnswersVisible = args.liveAnswersVisible;
        updatedFields.push("liveAnswersVisible");
      }

      // revealResponses: apply or clear.
      if (args.revealResponses === null) {
        delete next.revealResponses;
        updatedFields.push("revealResponses (cleared)");
      } else if (args.revealResponses !== undefined) {
        next.revealResponses = args.revealResponses;
        updatedFields.push("revealResponses");
      }

      // instructions: validate + apply.
      if (args.instructions === null) {
        delete next.instructions;
        updatedFields.push("instructions (cleared)");
      } else if (args.instructions !== undefined) {
        const r = normalizeInstructions(args.instructions);
        if (!r.ok) issues.push({ field: "instructions", error: r.error });
        else {
          next.instructions = r.value;
          updatedFields.push("instructions");
        }
      }

      // additionalInstructions: validate + apply.
      if (args.additionalInstructions === null) {
        delete next.additionalInstructions;
        updatedFields.push("additionalInstructions (cleared)");
      } else if (args.additionalInstructions !== undefined) {
        const r = normalizeAdditionalInstructions(args.additionalInstructions);
        if (!r.ok) issues.push({ field: "additionalInstructions", error: r.error });
        else {
          next.additionalInstructions = r.value;
          updatedFields.push("additionalInstructions");
        }
      }

      // hint: validate + apply.
      if (args.hint === null) {
        delete next.hint;
        updatedFields.push("hint (cleared)");
      } else if (args.hint !== undefined) {
        const r = validateHintConfig(args.hint, "hint");
        if (!r.ok) issues.push({ field: "hint", error: r.error });
        else {
          next.hint = r.value;
          updatedFields.push("hint");
        }
      }

      if (issues.length > 0) {
        return errorResult(issues.map((i) => `${i.field}: ${i.error}`).join("; "));
      }

      await saveTriviaConfig(next);

      return textResult({ action: "updated", updatedFields });
    },
  );
}
