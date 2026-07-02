## Context

`find_recent_interactions` (`src/tools/query/findRecentInteractions.ts`) always returns the paginated `entries`, and — when `include_usage: true` — additionally returns a `totalUsage` aggregate. The idler morning digest calls it purely to tally spend, but because it cannot ask for usage *without* entries, it drags back up to `limit` full entry summaries. Each idler entry's `firstQuestion` is the work-fire prompt, which embeds the entire ~18KB `fetch-instructions.md`; ten such entries exceed the SDK's tool-result token cap, so the result is offloaded to a file the model cannot extract `totalUsage` from. The digest has printed "Spend: unavailable — result payload too large to parse" for days.

The tool is internal and Claude-facing only. The single structured consumer of `totalUsage` is the idler summary prompt (`src/plugins/idler/prompts/summary.ts`); every other caller uses the tool for entries-only recall.

## Goals / Non-Goals

**Goals:**
- Let a caller request the usage aggregate *without* any entries, yielding a bounded, fixed-size result that cannot hit the tool-result cap.
- Replace the single-purpose `include_usage` boolean with a small, extensible projection selector.
- Fix the idler digest's spend line.

**Non-Goals:**
- Truncating entry text / shrinking `firstQuestion` for the general recall path (a separate hygiene concern, deliberately out of scope here).
- Changing `totalUsage` aggregation semantics (full matched set, pre-pagination, `since`-aware, zero for usage-less sessions).
- Fixing the digest prompt's epoch-ms `since` mis-conversion (rendered moot by usage-only projection; not touched).
- Any change to the cron scheduler wedge (tracked separately).

## Decisions

**1. `include: ("entries" | "usage")[]` projection selector, default `["entries"]`, replacing `include_usage`.**
The caller names the sections it wants; the tool returns an object with exactly those keys. `include: ["usage"]` computes and returns `totalUsage` alone and skips loading/summarizing entries entirely — a fixed ~5-field payload independent of matched-set size, so it can never overflow. Chosen over a second `usage_only` boolean (two interacting booleans is a worse API than one selector) and over merely truncating entries (doesn't address "usage without entries", and truncation is a broader change). The tool has no external consumers, so replacing the boolean outright (rather than deprecating alongside) is clean.

**2. Top-level result is always an object.** Previously the entries-only path returned a bare array and the usage path returned `{ entries, totalUsage }`. With a selector, the self-consistent contract is "an object with exactly the keys you asked for": `["entries"] → { entries }`, `["usage"] → { totalUsage }`, `["entries","usage"] → { entries, totalUsage }`. This changes the default recall result from array to `{ entries: [...] }`. Acceptable because all callers are Claude (which adapts) and the tool description documents it. Rejected the array-preserving alternative (bare array when only entries, object otherwise) as inconsistent and harder to describe.

**3. Usage-only skips entry work.** When `"entries"` is absent, the implementation must not build the per-session summaries at all — the whole point is to avoid emitting large `firstQuestion` values. Aggregation still walks the full filtered set (it already does, pre-pagination), so `totalUsage` is unaffected.

## Risks / Trade-offs

- **[Result shape change breaks a recall caller's expectations]** → All callers are Claude, and the only structured reader (`totalUsage`, in the idler summary prompt) is updated in this change. The tool description is updated so Claude sees the object contract. No code parses the raw array shape.
- **[A future caller forgets `"usage"` and reads `totalUsage: undefined`]** → The default `["entries"]` omits `totalUsage` by design; the description makes the projection explicit, and requesting `"usage"` is the documented path.
- **[`include: []` (empty) yields an empty object]** → Treat an empty/absent `include` as the default `["entries"]` so the tool never returns a contentless object.

## Migration Plan

1. Update the tool schema (`include` param + projected response) and the idler summary prompt (`include: ["usage"]`) together.
2. No persisted data, no data migration — purely an in-process tool contract.
3. Rollback: revert the two source edits; the boolean returns. Low risk.

## Open Questions

None.
