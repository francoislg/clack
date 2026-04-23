## Context

`fetch_channel_messages` (`src/tools/query/fetchChannelMessages.ts`) wraps Slack's `conversations.history` API. Its Zod schema documents `oldest`/`latest` as Unix epoch timestamp strings, but the handler passes the values straight through without validation or normalization. Claude — given a delivery preamble that includes `CURRENT DATE: 2026-04-23` and `USER TIMEZONE: America/New_York` — naturally produces ISO 8601 timestamps when asked about "yesterday." Slack coerces non-numeric strings via float parsing (`"2026-04-22T..."` → `2026`), silently yielding a zero-width window in 1970 and an empty result. The tool then returns `{messages: [], message_count: 0}`, identical to a genuinely quiet channel, leaving Claude with no signal that anything went wrong.

No other tool in the repo accepts user-supplied Slack timestamps (`adminDeleteMessage` uses a pre-formed `ts`), so the fix is local to one file and its tests.

## Goals / Non-Goals

**Goals:**
- Accept both Unix epoch strings and ISO 8601 / `Date.parse`-compatible strings as `oldest`/`latest` input.
- Surface parse failures as tool errors so Claude retries rather than reporting a false empty.
- Echo the effective query window (`oldest`, `latest`, plus ISO forms for self-check, and `has_more`) in every response so Claude can detect window mismatches.
- Keep existing callers (trivia, assistant-panel summarization without timestamps) working unchanged.

**Non-Goals:**
- Supporting natural-language phrases like "yesterday" or relative expressions. The goal is to forgive ISO datetime intuition, not to replace `date-fns`.
- Introducing a shared Slack-timestamp helper across tools. No other tool needs it today; extracting prematurely adds surface area without benefit.
- Enriching other tools' response shapes. Out of scope; each tool can adopt echo semantics when a similar issue surfaces there.
- Adding rate-limiting, retry, or pagination semantics. Orthogonal.

## Decisions

### Normalize in the handler, not as a Zod `.transform()`

Zod transforms run before the handler and would let us keep args typed as canonical epoch strings. However, transforms on MCP tool schemas don't always round-trip cleanly into the JSON Schema Claude sees, and the user-facing description ("Unix epoch seconds OR ISO 8601") carries more value when it stays on the public schema. Normalization lives in a small helper (`normalizeSlackTimestamp`) called at the top of the handler. Rejected: Zod `.transform()`.

### Accept any `Date.parse`-able string

`Date.parse` is generous — it accepts `"2026-04-22"`, `"2026-04-22T00:00:00-04:00"`, `"April 22 2026"`, etc. Generous is fine here: the goal is to forgive intuition, not police format. The only input we reject is one that produces `NaN` under both numeric-regex matching and `Date.parse`. Rejected: strict ISO 8601 regex, which would reject `"2026-04-22"` and other plausible agent outputs.

### Detection order: numeric first, then `Date.parse`

A bare `"1745294400"` is a valid epoch but also parses as a year under `Date.parse` (actually it throws `NaN`, but borderline inputs like `"2026"` do parse as a date in some implementations). To avoid ambiguity, the normalizer first checks `/^\d+(\.\d+)?$/`; if that matches, the value is treated as epoch seconds and passed through unchanged. Otherwise `Date.parse` runs and the result is divided by 1000 and formatted to six fractional digits (matching Slack's `ts` shape). Rejected: `Date.parse` first, which would misinterpret all-digit epoch strings as years on some runtimes.

### Unparseable input returns a tool error, not an empty result

`errorResult(...)` surfaces to Claude as a tool-call failure — Claude will see the error string and retry with corrected input. A soft fallback (returning `messages: []` with a warning field) is exactly the failure mode we're trying to eliminate. Rejected: warning field.

### Echo the window on both empty and non-empty paths, with both epoch and ISO forms

The current code sets `has_more` only on the non-empty branch (`fetchChannelMessages.ts:233`); the empty branch at line 193-200 returns without it. Unify both branches to always include `oldest`, `latest`, `oldest_iso`, `latest_iso`, and `has_more`. The ISO forms cost ~40 bytes and let Claude visually cross-check the window it queried against the window it intended. `oldest_iso`/`latest_iso` are omitted when the corresponding input wasn't provided (preserving the "unspecified = full history" semantics). Rejected: epoch-only echo, which is harder for Claude to self-verify.

### Capability placement: extend `channel-context`

`channel-context` already owns scenarios for `fetch_channel_messages`' response shape (channel name, reactions). Adding two requirements — input normalization and window echo — keeps related behavior colocated. No new capability needed.

## Risks / Trade-offs

- [Ambiguous single-word inputs like `"2026"` parsed by `Date.parse`] → Numeric-regex-first ordering guarantees all-digit strings stay as epoch. Non-digit inputs go through `Date.parse`, which for `"2026"` actually returns a valid January-1-2026 timestamp on V8 — harmless since the user wouldn't write that as an oldest/latest by accident.
- [Claude sees new fields in response and might reference them in user-visible output] → Block Kit rendering is unchanged; the extra fields are metadata for Claude's reasoning only. If a stray reference leaks, it's cosmetic.
- [Trivia scheduled prompts consume this tool output] → Trivia calls `fetch_channel_messages` without `oldest`/`latest`, so it will see `oldest`/`latest` omitted from the response (they're only set when input was provided). No breakage.
- [Date.parse browser vs Node quirks] → Only Node 20+ runs this code; `Date.parse` behavior is stable for ISO 8601 and common formats. Non-standard formats fail loudly (`NaN`), which is the desired behavior.
