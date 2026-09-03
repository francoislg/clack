/**
 * Validation for a season's optional `phases` array — the temporal twin of a
 * format's `slotOverrides`. A phase carries the full per-tier axis bag plus the
 * temporal fields (`slug`, `days`, `theme`, `categories`); slices are
 * duration-CHAINED, so the array-level invariants (unique slugs; every non-final
 * slice declares `days`; the final slice omits `days`) must hold as a whole — a
 * partially-applied chain would shift every later slice's window.
 *
 * Both entry points run each slice's axis bag through the SAME per-axis
 * normalization/validation a format slot gets (`collectSlotFieldIssues`), so a
 * partial weight map is filled and an all-zero map is rejected here exactly as it
 * would be on a slot:
 *   - `parsePhases` — the graceful file-load path. A disallowed key or a
 *     field-level failure (bad axis, `days: 0`, blank `theme`, `categories: []`)
 *     drops THAT field only and emits a `ParseIssue`; the slice survives. Only a
 *     whole-array hazard drops the entire array (see `parsePhases`).
 *   - `phasesStrictZod` + `normalizePhaseSlices` — the tool path. Structural,
 *     strict-key, and chaining failures come from `phasesStrictZod`; per-axis
 *     semantic failures come from `normalizePhaseSlices`, which fails fast with a
 *     message naming the slice's slug and field.
 */

import { z } from "zod";
import { collectSlotFieldIssues, dedupePreservingOrder, seasonFormatSlotZod } from "./format.js";
import type { ParseIssue } from "./axes.js";
import type { JsonObject } from "../configTypes.js";
import { validateSeasonSlug } from "../seasonTimeline.js";
import type { PhaseSlice } from "../types.js";
import type { Result } from "../../../../plugins-sdk/sdk.js";

/**
 * Structural / scoring-identity keys a phase MUST NOT carry (see `PhaseSlice`): a
 * phase changes what questions are LIKE, never what a round IS or how it is SCORED.
 * `.strict()` rejects them in the tool path; `parsePhases` drops them field-by-field.
 */
export const PHASE_DISALLOWED_KEYS = [
  "format",
  "slotOverrides",
  "teams",
  "teamsEnabled",
  "teamsFinaleIndividuals",
  "teamsScoring",
  "answeringType",
  "perfectRoundsAward",
  "allTimeRow",
] as const;

/** One phase slice: the full per-tier axis bag plus the temporal fields. */
export const phaseSliceZod = seasonFormatSlotZod.omit({ label: true }).extend({
  slug: z.string().superRefine((slug, ctx) => {
    const r = validateSeasonSlug(slug);
    if (!r.ok) ctx.addIssue({ code: "custom", message: r.error });
  }),
  days: z.number().int().positive().optional(),
  theme: z.string().trim().min(1).optional(),
  categories: z.array(z.string().trim().min(1)).min(1).transform(dedupePreservingOrder).optional(),
});

type StructuralPhaseSlice = z.infer<typeof phaseSliceZod>;

/**
 * The chaining invariants as a pure function so both the zod schema (via
 * `refinePhaseChaining`) and the lenient reader can run them. Each issue names the
 * offending slice's slug and is pathed at that slice.
 */
function phaseChainingIssues(
  phases: { slug: string; days?: number }[],
): { path: (string | number)[]; message: string }[] {
  const issues: { path: (string | number)[]; message: string }[] = [];
  const seen = new Set<string>();
  phases.forEach((phase, i) => {
    if (seen.has(phase.slug)) {
      issues.push({ path: [i, "slug"], message: `duplicate phase slug "${phase.slug}"` });
    } else {
      seen.add(phase.slug);
    }
    const isFinal = i === phases.length - 1;
    if (!isFinal && phase.days === undefined) {
      issues.push({
        path: [i, "days"],
        message: `non-final phase "${phase.slug}" must declare "days"`,
      });
    }
    if (isFinal && phase.days !== undefined) {
      issues.push({
        path: [i, "days"],
        message: `final phase "${phase.slug}" must not declare "days" (it runs to the season's end)`,
      });
    }
  });
  return issues;
}

/** The chaining invariants, applied by both the strict and lenient array schemas. */
function refinePhaseChaining(
  phases: { slug: string; days?: number }[],
  ctx: z.RefinementCtx,
): void {
  for (const issue of phaseChainingIssues(phases)) {
    ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
  }
}

/** Lenient array schema: unknown non-structural keys within a slice are silently stripped. */
export const phasesZod = z.array(phaseSliceZod).min(1).superRefine(refinePhaseChaining);

/**
 * Strict array schema for the tool path: a slice carrying a structural/scoring key
 * is rejected with the offending key named. Enforces STRUCTURE, strict keys, and
 * chaining only — `normalizePhaseSlices` layers on the per-axis semantics.
 */
export const phasesStrictZod = z
  .array(phaseSliceZod.strict())
  .min(1)
  .superRefine(refinePhaseChaining);

/** Build a `ParseIssue.field` path from a season slug and a zod issue path. */
function issueField(seasonSlug: string, path: readonly PropertyKey[]): string {
  let field = `seasons[${seasonSlug}].phases`;
  for (const seg of path) {
    field += typeof seg === "number" ? `[${seg}]` : `.${String(seg)}`;
  }
  return field;
}

/**
 * Deep-validate + normalize each structurally-parsed phase slice's axis bag with
 * the SAME per-axis semantics a format slot gets (`collectSlotFieldIssues`) —
 * missing weight keys filled, all-zero maps rejected — and return the fully-typed
 * `PhaseSlice[]`. `phasesStrictZod` has already enforced structure, strict keys,
 * and chaining, so this only adds what the structural schema can't express. Fails
 * fast with a message naming the slice's slug and field.
 */
export function normalizePhaseSlices(slices: StructuralPhaseSlice[]): Result<PhaseSlice[]> {
  const out: PhaseSlice[] = [];
  for (const slice of slices) {
    const { value, issues } = collectSlotFieldIssues(slice, `phase "${slice.slug}"`);
    if (issues.length > 0) return { ok: false, error: issues[0].error };
    out.push({
      slug: slice.slug,
      ...(slice.days !== undefined ? { days: slice.days } : {}),
      ...(slice.theme !== undefined ? { theme: slice.theme } : {}),
      ...value,
    });
  }
  return { ok: true, value: out };
}

/**
 * Graceful reader for a season's `phases`. Returns the parsed (deduped/trimmed/
 * normalized) array, or `undefined` when the array is dropped wholesale.
 *
 * Two failure classes, kept apart:
 *
 * - FIELD-level — a disallowed structural/scoring key, or a field that fails its
 *   own validation (bad axis value, all-zero weight map, `days: 0`, blank `theme`,
 *   `categories: []`). Drop THAT field only (its slice survives with the rest of
 *   its fields intact) and emit a `ParseIssue` naming it. A slice is NEVER dropped
 *   on its own — removing one would shift every later slice's window.
 *
 * - WHOLE-ARRAY — a chaining-invariant violation (duplicate slug, non-final slice
 *   missing `days`, final slice declaring `days`), a non-array `raw`, a non-object
 *   slice, or a slice whose `slug` is missing/invalid (slug is identity and drives
 *   dedup, so it cannot be repaired). Return `undefined` with a `ParseIssue`.
 */
export function parsePhases(
  raw: unknown,
  seasonSlug: string,
): { phases: PhaseSlice[] | undefined; issues: ParseIssue[] } {
  const issues: ParseIssue[] = [];
  if (!Array.isArray(raw)) {
    issues.push({
      field: `seasons[${seasonSlug}].phases`,
      error: `must be an array (got ${raw === null ? "null" : typeof raw})`,
    });
    return { phases: undefined, issues };
  }

  const sanitized: PhaseSlice[] = [];
  let wholeArrayDrop = false;

  raw.forEach((slice: unknown, i) => {
    const sliceField = `seasons[${seasonSlug}].phases[${i}]`;
    if (!slice || typeof slice !== "object" || Array.isArray(slice)) {
      issues.push({
        field: sliceField,
        error: `must be an object (got ${slice === null ? "null" : Array.isArray(slice) ? "array" : typeof slice})`,
      });
      wholeArrayDrop = true;
      return;
    }
    const obj = slice as JsonObject;

    // slug — identity; cannot be repaired, so a bad/missing one drops the array.
    const rawSlug = obj.slug;
    if (typeof rawSlug !== "string" || !validateSeasonSlug(rawSlug).ok) {
      const slugCheck = typeof rawSlug === "string" ? validateSeasonSlug(rawSlug) : null;
      issues.push({
        field: `${sliceField}.slug`,
        error:
          slugCheck && !slugCheck.ok ? slugCheck.error : "must be a non-empty kebab-case string",
      });
      wholeArrayDrop = true;
      return;
    }

    const phase: PhaseSlice = { slug: rawSlug };

    if (obj.days !== undefined) {
      if (typeof obj.days === "number" && Number.isInteger(obj.days) && obj.days > 0) {
        phase.days = obj.days;
      } else {
        issues.push({
          field: `${sliceField}.days`,
          error: `must be a positive integer (got ${JSON.stringify(obj.days)}); dropped`,
        });
      }
    }

    if (obj.theme !== undefined) {
      if (typeof obj.theme === "string" && obj.theme.trim().length > 0) {
        phase.theme = obj.theme.trim();
      } else {
        issues.push({ field: `${sliceField}.theme`, error: "must be a non-empty string; dropped" });
      }
    }

    // Strip disallowed structural/scoring keys field-by-field so each survives as a
    // ParseIssue while its slice lives on. `slug`/`days`/`theme` are handled above;
    // `label` is not a phase field, so drop it silently. Everything else is the axis
    // bag, deep-validated below.
    const axisRaw: JsonObject = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === "slug" || key === "days" || key === "theme" || key === "label") continue;
      if ((PHASE_DISALLOWED_KEYS as readonly string[]).includes(key)) {
        issues.push({
          field: `${sliceField}.${key}`,
          error:
            "not allowed on a phase (a phase changes what questions are LIKE, never how a round is scored); dropped",
        });
        continue;
      }
      axisRaw[key] = value;
    }

    const { value: axisValue, issues: axisIssues } = collectSlotFieldIssues(axisRaw, sliceField);
    for (const ai of axisIssues) {
      issues.push({ field: `${sliceField}.${ai.field}`, error: ai.error });
    }
    Object.assign(phase, axisValue);
    sanitized.push(phase);
  });

  if (wholeArrayDrop) return { phases: undefined, issues };

  const chainIssues = phaseChainingIssues(sanitized);
  if (chainIssues.length > 0) {
    for (const ci of chainIssues) {
      issues.push({ field: issueField(seasonSlug, ci.path), error: ci.message });
    }
    return { phases: undefined, issues };
  }

  return { phases: sanitized, issues };
}
