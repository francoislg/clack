## Why

The idler morning digest's spend line has read "unavailable — result payload too large to parse" for days. The cause: `find_recent_interactions` with `include_usage: true` returns the aggregate `totalUsage` **on top of** the paginated entries — and each idler entry's `firstQuestion` is the full work-fire prompt (which embeds the entire ~18KB `fetch-instructions.md`). Ten such entries blow past the SDK's tool-result token cap, so the result is offloaded to a file that Claude cannot extract `totalUsage` from. The caller wants *only* the aggregate, but the tool has no way to ask for usage *instead of* entries.

## What Changes

- **BREAKING** (Claude-facing tool schema only): replace the `include_usage: boolean` parameter on `find_recent_interactions` with an `include` projection selector — `include: ("entries" | "usage")[]`, default `["entries"]`. The tool returns an object projected to exactly the requested sections: `{ entries }`, `{ totalUsage }`, or `{ entries, totalUsage }`.
- `include: ["usage"]` returns **only** `totalUsage` (a fixed ~5-field object) and never any entries — a bounded payload that cannot overflow the tool-result cap regardless of window size or prompt bloat.
- The top-level result becomes an **object** in all cases (previously a bare array for the entries-only path); the per-entry field set and the `totalUsage` aggregation semantics are unchanged.
- Update the idler summary prompt to call `find_recent_interactions` with `include: ["usage"]` instead of `include_usage: true`.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `find-recent-interactions`: the "Optional usage aggregate" requirement is replaced by a projection selector (`include`) that lets the caller request entries, usage, or both; the result-format requirement changes from a bare entries array to a projected object.
- `idler-plugin`: the summary digest's usage-tally query switches from `include_usage: true` to `include: ["usage"]`.

## Impact

- Code: `src/tools/query/findRecentInteractions.ts` (tool schema + response projection), `src/plugins/idler/prompts/summary.ts` (prompt wording).
- Tests: `src/tools/query/findRecentInteractions.test.ts`, `src/plugins/idler/prompts/summary.test.ts`.
- Consumers: only the idler summary reads `totalUsage`; all other callers use the tool for entries-only recall and are unaffected by the `include` default. No persisted data or migration involved. The tool is internal/Claude-facing, so the schema change has no external API surface.
