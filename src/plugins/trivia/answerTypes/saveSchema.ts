/**
 * Zod schema for `save_question`'s handler-facing argument set — everything
 * the tool passes through to `handler.getSavedQuestion(base, args, ctx)`.
 * Importantly does NOT include `game`: that's a tool-level concern, scoped
 * to which game directory the write lands in, and the per-format handlers
 * have no business knowing about it.
 *
 * The per-answersFormat fields (isTrue / choices+correctIndex /
 * expectedAnswer+...) are CONTRIBUTED BY THE HANDLERS via the registry's
 * `ALL_ANSWER_TYPE_SAVE_FIELDS` spread. Adding a 4th format means writing
 * one new `*_SAVE_FIELDS` in its handler module — this schema doesn't move.
 *
 * Sourcing the type via `z.infer` from this object — and having the tool
 * spread these fields into its own schema — means the handler's input type
 * and the tool's argument type can NEVER drift. No casts needed at the
 * boundary.
 */

import { z } from "zod";
import { ALL_QUESTION_TYPE_SAVE_FIELDS } from "../questionTypes/registry.js";
import { ALL_ANSWER_TYPE_SAVE_FIELDS } from "./registry.js";

/**
 * Cross-axis fields the tool stamps unconditionally. The two discriminators
 * (`answersFormat`, `questionType`) are here because every record carries
 * them; the per-axis additive fields (per-format and per-questionType) are
 * spread in below from each axis's registry.
 */
const COMMON_SAVE_FIELDS = {
  answersFormat: z
    .enum(["boolean", "choice", "freeform"])
    .describe('Answer shape: "boolean", "choice", or "freeform" (user types the answer).'),
  questionType: z
    .enum(["fact", "topical", "prediction"])
    .describe(
      'Source axis: "fact" for static knowledge, "topical" for a recent event (requires sourceUrl), "prediction" for an UPCOMING event whose outcome is unknown — requires sourceUrl, saved WITHOUT an answer key, settled later. Composes with every answer format.',
    ),
  category: z.string().describe("The category from the pool (must exist)"),
  statement: z.string().describe("The trivia statement"),
  context: z
    .string()
    .optional()
    .describe(
      "OPTIONAL: the lens (from contextPriority) used to generate the question. Empty string = no lens. Non-empty must appear in the active contexts list at this slot/season/config tier.",
    ),
  suggestedDifficulty: z
    .enum(["Easy", "Medium", "Hard"])
    .optional()
    .describe("The difficulty bucket targeted at gen time (from get_ideas' suggestedDifficulty)."),
  difficulty: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("Your 1–10 self-rating from the difficulty gate."),
  emojis: z.array(z.string()).describe("1-4 topic-relevant emojis"),
  slot: z
    .object({
      index: z.number().int().nonnegative(),
      label: z.string().optional(),
    })
    .optional()
    .describe(
      "REQUIRED when the active season has a `format`; MUST BE OMITTED when the active season has no format. `index` selects which slot this question fills; `label` is informational (the stored record snapshots the label from format.questions[index].label, not from this argument).",
    ),
  hint: z
    .object({
      mode: z.enum(["button", "inline"]),
      text: z.string(),
    })
    .optional()
    .describe(
      'OPTIONAL: the hint produced by the HINT DRAFTING GATE. Include IFF `get_ideas` returned `suggestedHintMode !== "none"` AND the gate produced a usable hint. `mode` MUST equal the `suggestedHintMode` value. `text` is the trimmed hint string, ≤140 chars after trim. Mode "none" is unrepresentable on this field — omit `hint` entirely when no hint should attach. Omitting is acceptable even when get_ideas suggested a non-"none" mode (the gate may judge no useful nudge exists).',
    ),
} as const;

/**
 * Full handler-facing field set: cross-axis common fields + every registered
 * answer-format's per-format fields + every registered question-type's
 * per-tier fields. The tool spreads these into its own schema (alongside
 * `game`); the handler receives the inferred type.
 */
export const SAVE_QUESTION_HANDLER_FIELDS = {
  ...COMMON_SAVE_FIELDS,
  ...ALL_ANSWER_TYPE_SAVE_FIELDS,
  ...ALL_QUESTION_TYPE_SAVE_FIELDS,
} as const;

/**
 * The inferred type the handler receives. Single source of truth — sharing
 * the schema between tool and handler eliminates the cast at the boundary.
 */
export type SaveQuestionArgs = z.infer<z.ZodObject<typeof SAVE_QUESTION_HANDLER_FIELDS>>;
