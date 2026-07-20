/**
 * Pure validation primitives for the trivia cascading axes. Each `*Check`
 * returns the FIRST located failure (or null), mirroring the labeled
 * `'field.path' …` contract; `schemaFromChecker` wraps a checker + normalizer
 * into a zod schema, and `safeParseToResult` adapts the parse outcome to the
 * SDK `Result` shape (with `zodErrorToResult` supplying the field-label prefix).
 *
 * All vocab (key sets, defaults) is passed in by the caller so this module has
 * no dependency on `axes.ts` — `axes.ts` owns the constants and composes these
 * primitives into the concrete per-axis schemas.
 */

import { z } from "zod";
import type { JsonObject, JsonValue, TriviaContextEntry } from "../configTypes.js";
import { zodErrorToResult, type Result } from "../../../../plugins-sdk/sdk.js";

/** A located validation failure. `path` is relative to the schema's field label. */
export interface CheckIssue {
  path: (string | number)[];
  message: string;
}
export type Checker = (raw: unknown) => CheckIssue | null;

export function isJsonObject(raw: unknown): raw is JsonObject {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

export function schemaFromChecker<T>(check: Checker, normalize: (raw: unknown) => T): z.ZodType<T> {
  const schema = z
    .unknown()
    .superRefine((raw, ctx) => {
      const issue = check(raw);
      if (issue) ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
    })
    .transform((raw) => normalize(raw));
  return schema as z.ZodType<T>;
}

export function safeParseToResult<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fieldLabel: string,
): Result<T> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  return zodErrorToResult(parsed.error, fieldLabel);
}

// --- Weight maps -----------------------------------------------------------

export function weightMapCheck(
  raw: unknown,
  keys: readonly string[],
  prefix: (string | number)[],
): CheckIssue | null {
  if (!isJsonObject(raw)) return { path: prefix, message: "must be an object" };
  for (const key of Object.keys(raw)) {
    if (!keys.includes(key)) {
      return {
        path: prefix,
        message: `contains unknown key '${key}' (allowed: ${keys.join(", ")})`,
      };
    }
  }
  for (const key of keys) {
    const value = raw[key];
    if (value === undefined) continue;
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      value < 0
    ) {
      return {
        path: [...prefix, key],
        message: `must be a non-negative integer (got ${JSON.stringify(value)})`,
      };
    }
  }
  const hasPositive = keys.some((key) => {
    const value = raw[key];
    return typeof value === "number" && value > 0;
  });
  if (!hasPositive)
    return { path: prefix, message: "must have at least one strictly positive weight" };
  return null;
}

export function normalizeWeights<K extends string>(
  raw: unknown,
  keys: readonly K[],
): Record<K, number> {
  const obj = isJsonObject(raw) ? raw : {};
  const out: { [key: string]: number } = {};
  for (const key of keys) {
    const value = obj[key];
    out[key] = typeof value === "number" ? value : 0;
  }
  return out as Record<K, number>;
}

// --- Contexts --------------------------------------------------------------

export function contextsCheck(raw: unknown): CheckIssue | null {
  if (!Array.isArray(raw)) return { path: [], message: "must be an array" };
  if (raw.length === 0) return { path: [], message: "must be non-empty when present" };
  const seenNames = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const entry: unknown = raw[i];
    if (!isJsonObject(entry)) return { path: [i], message: "must be an object" };
    const name = entry.name;
    if (typeof name !== "string") return { path: [i, "name"], message: "must be a string" };
    if (seenNames.has(name)) return { path: [i], message: `has duplicate name '${name}'` };
    seenNames.add(name);
    const weight = entry.weight;
    if (weight !== undefined) {
      if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) {
        return {
          path: [i, "weight"],
          message: `must be a positive number (got ${JSON.stringify(weight)})`,
        };
      }
    }
  }
  return null;
}

export function normalizeContexts(raw: unknown): TriviaContextEntry[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: TriviaContextEntry[] = [];
  for (const entry of arr) {
    if (!isJsonObject(entry) || typeof entry.name !== "string") continue;
    const weight = entry.weight;
    out.push(typeof weight === "number" ? { name: entry.name, weight } : { name: entry.name });
  }
  return out;
}

// --- Difficulty ranges -----------------------------------------------------

export function rangeIssue(
  value: JsonValue | undefined,
  path: (string | number)[],
): CheckIssue | null {
  if (!Array.isArray(value) || value.length !== 2) {
    return { path, message: "must be a [min, max] tuple" };
  }
  const [min, max] = value;
  if (typeof min !== "number" || !Number.isInteger(min) || min < 1 || min > 10) {
    return {
      path: [...path, 0],
      message: `must be an integer in [1, 10] (got ${JSON.stringify(min)})`,
    };
  }
  if (typeof max !== "number" || !Number.isInteger(max) || max < 1 || max > 10) {
    return {
      path: [...path, 1],
      message: `must be an integer in [1, 10] (got ${JSON.stringify(max)})`,
    };
  }
  if (min > max) return { path, message: `min (${min}) must be <= max (${max})` };
  return null;
}

export function rangesMapCheck(
  raw: unknown,
  prefix: (string | number)[],
  buckets: readonly string[],
): CheckIssue | null {
  if (!isJsonObject(raw)) return { path: prefix, message: "must be an object" };
  for (const key of Object.keys(raw)) {
    if (!buckets.includes(key)) {
      return {
        path: prefix,
        message: `contains unknown key '${key}' (allowed: ${buckets.join(", ")})`,
      };
    }
  }
  for (const bucket of buckets) {
    if (raw[bucket] === undefined) continue;
    const issue = rangeIssue(raw[bucket], [...prefix, bucket]);
    if (issue) return issue;
  }
  return null;
}

/** Build a per-format checker that runs `inner` for each present format key. */
export function perFormatCheck(
  raw: unknown,
  formats: readonly string[],
  inner: (value: JsonValue, prefix: (string | number)[]) => CheckIssue | null,
): CheckIssue | null {
  if (!isJsonObject(raw)) return { path: [], message: "must be an object" };
  for (const key of Object.keys(raw)) {
    if (!formats.includes(key)) {
      return {
        path: [],
        message: `contains unknown key '${key}' (allowed: ${formats.join(", ")})`,
      };
    }
  }
  for (const fmt of formats) {
    const value = raw[fmt];
    if (value === undefined) continue;
    const issue = inner(value, [fmt]);
    if (issue) return issue;
  }
  return null;
}

// --- Hint / enums / choices ------------------------------------------------

export function hintCheck(
  raw: unknown,
  modeKeys: readonly string[],
  bucketKeys: readonly string[],
  allowedFields: readonly string[],
): CheckIssue | null {
  if (!isJsonObject(raw)) return { path: [], message: "must be an object" };
  for (const key of Object.keys(raw)) {
    if (!allowedFields.includes(key)) {
      return { path: [], message: `contains unknown key '${key}' (allowed: mode, minDifficulty)` };
    }
  }
  const mode = raw.mode;
  if (typeof mode !== "string" || !modeKeys.includes(mode)) {
    return {
      path: ["mode"],
      message: `must be one of ${modeKeys.join(", ")} (got ${JSON.stringify(mode)})`,
    };
  }
  const minDifficulty = raw.minDifficulty;
  if (minDifficulty !== undefined && minDifficulty !== null) {
    if (typeof minDifficulty !== "string" || !bucketKeys.includes(minDifficulty)) {
      return {
        path: ["minDifficulty"],
        message: `must be one of ${bucketKeys.join(", ")} (got ${JSON.stringify(minDifficulty)})`,
      };
    }
  }
  return null;
}

export function enumCheck(raw: unknown, keys: readonly string[]): CheckIssue | null {
  if (typeof raw !== "string" || !keys.includes(raw)) {
    return { path: [], message: `must be one of ${keys.join(", ")} (got ${JSON.stringify(raw)})` };
  }
  return null;
}

/**
 * `points` axis. `max` is REQUIRED (whole-object replace per tier means a tier
 * value without a cap would silently mask a lower tier's cap); `guidance` is
 * optional free text.
 */
export function pointsCheck(
  raw: unknown,
  bounds: { max: number; guidanceMaxLength: number },
): CheckIssue | null {
  if (!isJsonObject(raw)) return { path: [], message: "must be an object" };
  const { max, guidance } = raw;
  if (max === undefined) return { path: ["max"], message: "is required" };
  if (typeof max !== "number" || !Number.isInteger(max) || max < 1 || max > bounds.max) {
    return {
      path: ["max"],
      message: `must be an integer in [1, ${bounds.max}] (got ${JSON.stringify(max)})`,
    };
  }
  if (guidance !== undefined) {
    if (typeof guidance !== "string" || guidance.trim().length === 0) {
      return { path: ["guidance"], message: "must be a non-empty string when set" };
    }
    if (guidance.trim().length > bounds.guidanceMaxLength) {
      return {
        path: ["guidance"],
        message: `must be at most ${bounds.guidanceMaxLength} characters (got ${guidance.trim().length})`,
      };
    }
  }
  return null;
}

export function choicesCheck(
  raw: unknown,
  defaults: { min: number; max: number },
): CheckIssue | null {
  if (!isJsonObject(raw)) return { path: [], message: "must be an object" };
  const min = raw.min ?? defaults.min;
  const max = raw.max ?? defaults.max;
  if (typeof min !== "number" || !Number.isInteger(min) || min < 2 || min > 4) {
    return { path: ["min"], message: `must be an integer in [2, 4] (got ${JSON.stringify(min)})` };
  }
  if (typeof max !== "number" || !Number.isInteger(max) || max < 2 || max > 4) {
    return { path: ["max"], message: `must be an integer in [2, 4] (got ${JSON.stringify(max)})` };
  }
  if (min > max) return { path: [], message: `min (${min}) must be <= max (${max})` };
  return null;
}
