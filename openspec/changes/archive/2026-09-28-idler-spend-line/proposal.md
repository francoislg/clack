## Why

The idler's morning digest reports spend wrong. On 2026-09-28 it posted `🧮 Spend: 5518918 tokens · ~$2.93`. The prompt asks Claude to add `inputTokens + outputTokens` itself, which it did not do correctly: 5,518,918 matches no sum of the components. The formula is also misleading. With prompt caching, uncached input is close to zero, so "input + output" would report about 7K tokens for a $2.93 night. `costUsd` is trustworthy; the token figure is not.

## What Changes

- `find_recent_interactions`'s `totalUsage` gains two server-computed fields:
  - `totalTokens`: the sum of all four token components (input, output, cache read, cache creation).
  - `summary`: a ready-to-print string, cost first, e.g. `~$2.93 · 5.53M tokens (5.09M cached)`. Token counts are abbreviated to three significant digits. "Cached" means cache-read tokens.
- The idler summary prompt prints the spend line as `🧮 Spend: <totalUsage.summary>` verbatim. Claude does no arithmetic and no formatting.
- The spend window matches the activity log's window. The summary only fires on work-window days, so Monday's digest lists Friday night's actions, but a fixed 24h tally drops Friday's spend. From now on:
  - `clear_activity` stamps `windowStart` (epoch ms, server clock) into `activity.json`.
  - `read_activity` returns it.
  - The summary passes it verbatim as `since`.
  - A never-cleared log falls back to `since_hours: 24`.
- The idler digest spec is brought in line with the shipped `plugin: "idler"` actor scope, not the reporting-channel scope.

Out of scope: worker runs that continue a session created before the window are still not counted, because usage is summed per session by creation time.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `find-recent-interactions`: the `totalUsage` aggregate adds `totalTokens` and a formatted `summary` string.
- `idler-plugin`: the digest's spend line becomes cost-first and counts every token component, printed from `totalUsage.summary`. The spend window follows the activity log's window (`windowStart` from `read_activity`), and the scope wording matches the shipped `plugin: "idler"` call.

## Impact

- `src/claude/usage.ts`: new pure helpers for the token total and the summary format.
- `src/tools/query/findRecentInteractions.ts`: attaches `totalTokens` and `summary` to `totalUsage`, and updates the tool description.
- `src/plugins/idler/prompts/summary.ts`: the spend-line instruction.
- `src/plugins/idler/activity.ts` + `tools/activity.ts`: an optional `windowStart` in `activity.json`, stamped on clear and returned by `read_activity`. The graceful reader treats a missing value as `null`, so no migration is needed.
- Unit tests for the helpers and for the tool's `totalUsage` shape.
- No config or Slack-scope changes.
