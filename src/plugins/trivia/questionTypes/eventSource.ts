/**
 * Shared `sourceUrl` + `eventDate` validation for the two web-search question
 * types (`topical` = recent event, `prediction` = upcoming event). Both require an
 * HTTPS `sourceUrl` citation and accept an optional ISO 8601 `eventDate`; the only
 * difference is the noun in the error message and prediction's extra `resolved: false`
 * stamp, which the caller composes onto the returned extras.
 */

import type { JsonValue } from "../core/configTypes.js";
import type { SaveQuestionArgs } from "../answerTypes/saveSchema.js";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type EventSourceOutcome =
  | { ok: true; recordExtras: Record<string, JsonValue> }
  | { ok: false; error: string };

export function validateEventSource(args: SaveQuestionArgs, eventNoun: string): EventSourceOutcome {
  if (args.sourceUrl === undefined || args.sourceUrl.length === 0) {
    return {
      ok: false,
      error: `${eventNoun} questions require "sourceUrl" (an HTTPS citation URL).`,
    };
  }
  if (!args.sourceUrl.startsWith("https://")) {
    return { ok: false, error: '"sourceUrl" must use https://.' };
  }
  const hostPart = args.sourceUrl.slice("https://".length).split("/")[0];
  if (hostPart.length === 0 || !hostPart.includes(".")) {
    return { ok: false, error: '"sourceUrl" must include a valid host.' };
  }
  if (args.eventDate !== undefined && !ISO_DATE_RE.test(args.eventDate)) {
    return {
      ok: false,
      error: '"eventDate" must be ISO 8601 calendar date (YYYY-MM-DD).',
    };
  }
  const recordExtras: Record<string, JsonValue> = { sourceUrl: args.sourceUrl };
  if (args.eventDate !== undefined) recordExtras.eventDate = args.eventDate;
  return { ok: true, recordExtras };
}
