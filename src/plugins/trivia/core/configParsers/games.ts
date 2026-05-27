/**
 * Per-game and offDays parsers. Pure functions returning parsed values + any
 * issues to log. Used by the trivia config bridge (file loader) and by the
 * upsert_game / set_workspace_config management tools (strict mode — they
 * throw on issues).
 */

import { CronExpressionParser } from "cron-parser";
import type {
  JsonObject,
  JsonValue,
  OffDay,
  RevealResponsesMode,
  TriviaGame,
} from "../configTypes.js";
import { isRevealResponsesMode, parseTriviaAxisBag, type ParseIssue } from "./axes.js";
import { validateFormat } from "./format.js";

/** Game-name format: filesystem-safe kebab-case, 1–32 chars. */
const TRIVIA_GAME_NAME_RE = /^[a-z0-9-]+$/;

/** Slack channel ID format — plugin-local, no bot-core import. */
function isChannelId(input: string): boolean {
  return /^[CGD][A-Z0-9_]+$/.test(input);
}

/**
 * Parse a single `TriviaGame` entry. Scheduling validation is strict — any
 * problem rejects the whole entry. Axis-bag validation is lenient — malformed
 * axis fields drop but the entry survives.
 */
export function parseTriviaGame(
  raw: JsonValue,
  index: number,
  seenNames: Set<string>,
): { game: TriviaGame | null; issues: ParseIssue[] } {
  const fieldPrefix = `trivia.games[${index}]`;
  const issues: ParseIssue[] = [];

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    issues.push({ field: fieldPrefix, error: "must be an object" });
    return { game: null, issues };
  }
  const e: JsonObject = raw;
  const name = typeof e.name === "string" ? e.name : "";
  const channel = typeof e.channel === "string" ? e.channel : "";
  const questionCron = typeof e.questionCron === "string" ? e.questionCron : "";
  const revealCron = typeof e.revealCron === "string" ? e.revealCron : "";
  const timezone = typeof e.timezone === "string" ? e.timezone : "";

  if (name.length === 0) {
    issues.push({ field: `${fieldPrefix}.name`, error: "must be a non-empty string" });
    return { game: null, issues };
  }
  if (name.length > 32) {
    issues.push({ field: `${fieldPrefix}.name`, error: `"${name}" exceeds 32 characters` });
    return { game: null, issues };
  }
  if (!TRIVIA_GAME_NAME_RE.test(name)) {
    issues.push({
      field: `${fieldPrefix}.name`,
      error: `"${name}" must match /^[a-z0-9-]+$/ (lowercase, digits, hyphens)`,
    });
    return { game: null, issues };
  }
  if (seenNames.has(name)) {
    issues.push({ field: fieldPrefix, error: `duplicate name "${name}"` });
    return { game: null, issues };
  }
  if (!isChannelId(channel)) {
    issues.push({
      field: `${fieldPrefix}.channel`,
      error: `"${channel}" is not a Slack channel ID (expected C…/G…/D…)`,
    });
    return { game: null, issues };
  }
  try {
    CronExpressionParser.parse(questionCron, { tz: timezone || "UTC" });
  } catch (err) {
    issues.push({
      field: `${fieldPrefix}.questionCron`,
      error: `"${questionCron}" is invalid (${err instanceof Error ? err.message : String(err)})`,
    });
    return { game: null, issues };
  }
  try {
    CronExpressionParser.parse(revealCron, { tz: timezone || "UTC" });
  } catch (err) {
    issues.push({
      field: `${fieldPrefix}.revealCron`,
      error: `"${revealCron}" is invalid (${err instanceof Error ? err.message : String(err)})`,
    });
    return { game: null, issues };
  }
  if (timezone.length === 0) {
    issues.push({ field: `${fieldPrefix}.timezone`, error: "must be a non-empty IANA tz string" });
    return { game: null, issues };
  }

  let enabled = true;
  if ("enabled" in e && e.enabled !== undefined) {
    if (typeof e.enabled !== "boolean") {
      issues.push({ field: `${fieldPrefix}.enabled`, error: "must be a boolean" });
      return { game: null, issues };
    }
    enabled = e.enabled;
  }

  const { axes, issues: axisIssues } = parseTriviaAxisBag(e, fieldPrefix);
  issues.push(...axisIssues);

  // Optional structural fields — `format`, `categories`, `theme`. Same lenient
  // drop-on-invalid policy as the axis bag: the invalid field is dropped and an
  // issue is logged, but the rest of the entry survives.
  let format: TriviaGame["format"];
  if (e.format !== undefined && e.format !== null) {
    const formatField = `${fieldPrefix}.format`;
    if (typeof e.format !== "object" || Array.isArray(e.format)) {
      issues.push({ field: formatField, error: "must be an object" });
    } else {
      const r = validateFormat(e.format as JsonObject, formatField);
      if (r.ok) format = r.value;
      else issues.push({ field: formatField, error: r.error });
    }
  }

  let categories: string[] | undefined;
  if (e.categories !== undefined && e.categories !== null) {
    const categoriesField = `${fieldPrefix}.categories`;
    if (!Array.isArray(e.categories)) {
      issues.push({ field: categoriesField, error: "must be an array" });
    } else {
      const trimmed: string[] = [];
      const seen = new Set<string>();
      let invalidEntry = false;
      for (const c of e.categories) {
        if (typeof c !== "string") {
          issues.push({ field: categoriesField, error: "every entry must be a string" });
          invalidEntry = true;
          break;
        }
        const t = c.trim();
        if (t.length === 0) continue;
        if (seen.has(t)) continue;
        seen.add(t);
        trimmed.push(t);
      }
      if (!invalidEntry) {
        if (trimmed.length === 0) {
          issues.push({
            field: categoriesField,
            error: "must contain at least one non-empty string",
          });
        } else {
          categories = trimmed;
        }
      }
    }
  }

  let theme: string | undefined;
  if (e.theme !== undefined && e.theme !== null) {
    const themeField = `${fieldPrefix}.theme`;
    if (typeof e.theme !== "string") {
      issues.push({ field: themeField, error: "must be a string" });
    } else {
      const trimmed = e.theme.trim();
      if (trimmed.length === 0) {
        issues.push({ field: themeField, error: "must be non-empty after trim" });
      } else {
        theme = trimmed;
      }
    }
  }

  let instructions: string | undefined;
  if (e.instructions !== undefined && e.instructions !== null) {
    const field = `${fieldPrefix}.instructions`;
    if (typeof e.instructions !== "string") {
      issues.push({ field, error: "must be a string" });
    } else {
      const trimmed = e.instructions.trim();
      if (trimmed.length === 0) {
        issues.push({ field, error: "must be non-empty after trim" });
      } else {
        instructions = trimmed;
      }
    }
  }

  let additionalInstructions: string | undefined;
  if (e.additionalInstructions !== undefined && e.additionalInstructions !== null) {
    const field = `${fieldPrefix}.additionalInstructions`;
    if (typeof e.additionalInstructions !== "string") {
      issues.push({ field, error: "must be a string" });
    } else {
      const trimmed = e.additionalInstructions.trim();
      if (trimmed.length === 0) {
        issues.push({ field, error: "must be non-empty after trim" });
      } else {
        additionalInstructions = trimmed;
      }
    }
  }

  let liveAnswersVisible: boolean | undefined;
  if (e.liveAnswersVisible !== undefined && e.liveAnswersVisible !== null) {
    if (typeof e.liveAnswersVisible !== "boolean") {
      issues.push({
        field: `${fieldPrefix}.liveAnswersVisible`,
        error: `must be a boolean (got ${typeof e.liveAnswersVisible})`,
      });
    } else {
      liveAnswersVisible = e.liveAnswersVisible;
    }
  }

  let revealResponses: RevealResponsesMode | undefined;
  if (e.revealResponses !== undefined && e.revealResponses !== null) {
    if (isRevealResponsesMode(e.revealResponses)) {
      revealResponses = e.revealResponses;
    } else {
      issues.push({
        field: `${fieldPrefix}.revealResponses`,
        error: `must be one of "no", "just-correctness", "yes" (got ${JSON.stringify(e.revealResponses)})`,
      });
    }
  }

  seenNames.add(name);
  return {
    game: {
      name,
      channel,
      questionCron,
      revealCron,
      timezone,
      enabled,
      ...axes,
      ...(format ? { format } : {}),
      ...(categories ? { categories } : {}),
      ...(theme ? { theme } : {}),
      ...(instructions ? { instructions } : {}),
      ...(additionalInstructions ? { additionalInstructions } : {}),
      ...(liveAnswersVisible !== undefined ? { liveAnswersVisible } : {}),
      ...(revealResponses !== undefined ? { revealResponses } : {}),
    },
    issues,
  };
}

export function parseTriviaGames(raw: JsonValue | undefined): {
  games: TriviaGame[] | undefined;
  issues: ParseIssue[];
} {
  if (raw === undefined) return { games: undefined, issues: [] };
  if (!Array.isArray(raw)) {
    return {
      games: [],
      issues: [{ field: "trivia.games", error: "must be an array — ignoring" }],
    };
  }
  const out: TriviaGame[] = [];
  const seenNames = new Set<string>();
  const issues: ParseIssue[] = [];
  for (let i = 0; i < raw.length; i++) {
    const { game, issues: itemIssues } = parseTriviaGame(raw[i], i, seenNames);
    issues.push(...itemIssues);
    if (game) out.push(game);
  }
  return { games: out, issues };
}

const DAYS_IN_MONTH = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isRealCalendarDate(year: number | null, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  const maxDay = year === null ? DAYS_IN_MONTH[month] : new Date(year, month, 0).getDate();
  return day >= 1 && day <= maxDay;
}

export function parseOffDays(raw: JsonValue | undefined): {
  offDays: OffDay[] | undefined;
  issues: ParseIssue[];
} {
  if (raw === undefined) return { offDays: undefined, issues: [] };
  if (!Array.isArray(raw)) {
    return {
      offDays: [],
      issues: [{ field: "trivia.offDays", error: "must be an array — ignoring" }],
    };
  }
  const exactRe = /^(\d{4})-(\d{2})-(\d{2})$/;
  const recurringRe = /^(\d{2})-(\d{2})$/;
  const out: OffDay[] = [];
  const issues: ParseIssue[] = [];

  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    const fieldPrefix = `trivia.offDays[${i}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      issues.push({ field: fieldPrefix, error: "must be an object" });
      continue;
    }
    const e: JsonObject = entry;
    const date = typeof e.date === "string" ? e.date : "";
    const label = typeof e.label === "string" ? e.label : "";

    if (date.length === 0) {
      issues.push({ field: `${fieldPrefix}.date`, error: "must be a non-empty string" });
      continue;
    }
    const exactMatch = exactRe.exec(date);
    const recurringMatch = recurringRe.exec(date);
    if (!exactMatch && !recurringMatch) {
      issues.push({
        field: `${fieldPrefix}.date`,
        error: `"${date}" must be YYYY-MM-DD or MM-DD`,
      });
      continue;
    }
    const year = exactMatch ? Number(exactMatch[1]) : null;
    const m = (exactMatch ?? recurringMatch)!;
    const month = Number(exactMatch ? m[2] : m[1]);
    const day = Number(exactMatch ? m[3] : m[2]);
    if (!isRealCalendarDate(year, month, day)) {
      issues.push({
        field: `${fieldPrefix}.date`,
        error: `"${date}" is not a real calendar date`,
      });
      continue;
    }
    if (label.length === 0) {
      issues.push({ field: `${fieldPrefix}.label`, error: "must be a non-empty string" });
      continue;
    }
    out.push({ date, label });
  }
  return { offDays: out, issues };
}
