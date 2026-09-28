## Context

Each Claude run records `SessionUsage` (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreationTokens`, `costUsd`) from the SDK's terminal `result` message (`src/claude/usage.ts`). `addSessionUsage` accumulates it per session, and worker runs fold onto the idler session that staged them. The idler summary fire calls `find_recent_interactions` with `plugin: "idler"`, `trigger_type: "scheduled"`, `since_hours: 24` and `include: ["usage"]`. The tool sums `usage` across matched sessions into `totalUsage`. Today the prompt asks Claude to add two of the components and format the line, and Claude got the arithmetic wrong.

On a cached night the components look like this: input 84, output 7,378, cache read 5.09M, cache creation 426K, cost $2.93.

## Goals / Non-Goals

**Goals:**
- A spend line that is computed and formatted in code, so no model arithmetic is involved.
- A line that shows what drives the cost: the dollar figure first, then all tokens, with the cached share called out.

**Non-Goals:**
- Counting worker runs that continue sessions created before the window, which would need per-run timestamped usage.
- Exact billing reconciliation. `costUsd` (the SDK's `total_cost_usd`) is the source of truth for dollars.

## Decisions

- **Format in core, not in the plugin.** The idler cannot compute the line itself because plugins have no access to session usage beyond this tool. The formatted string is therefore a field on `find_recent_interactions`'s `totalUsage`, worded generically (no emoji, no "Spend:" label) so any caller can use it. The idler prompt adds its own `🧮 Spend:` prefix.
- **Pure helpers in `src/claude/usage.ts`.** Add `totalTokens(usage)` and `formatUsageSummary(usage)` next to `SessionUsage` and `addUsage`. They are unit tested in `usage.test.ts`. The tool test mocks both helpers (partial `vi.mock` of `usage.js`, keeping `addUsage` real). It then asserts that they receive the aggregate and that their return values land on `totalUsage`, without re-testing the formatting.
- **Line shape (chosen by the user): `~$<cost 2dp> · <total> tokens (<cacheRead> cached)`.** Example: `~$2.93 · 5.53M tokens (5.09M cached)`.
  - Token counts use three significant digits with a K/M suffix: `84`, `7.38K`, `426K`, `5.53M`. Counts below 1,000 are printed as plain integers. A value that would round to 1000 in its unit moves up to the next suffix, so 999,999 → `1.00M`, never `1000K`.
  - The `(… cached)` part is omitted when `cacheReadTokens` is 0, which includes the zero-usage window: `~$0.00 · 0 tokens`.
  - Cache creation tokens count toward the total but get no separate label. The parenthetical explains why a large token count is cheap: cache reads bill at about 10% of the input price.
- **`totalUsage` keeps its five components.** `totalTokens` and `summary` are added beside them, so the change is additive for any caller that reads the raw numbers.
- **The spend window is the activity log's window.** `clear_activity` writes `{ entries: [], windowStart: Date.now() }`, and `read_activity` returns `windowStart` (or `null` when the file has none). The summary passes it as `find_recent_interactions`'s `since`, a value the tool's description already allows when it comes from another tool result. This lines up with the activity log when the summary skips off-window days: Monday's digest covers from Friday's clear onward. A fixed `since_hours: 24` was rejected because it drops Friday evening's spend while still listing Friday evening's actions. A null `windowStart` (never cleared, e.g. the first digest after deploy) falls back to `since_hours: 24`. The `windowStart` field is optional in the graceful zod schema, so existing files still parse.
- **The string stays English.** `summary` is returned to Claude inside a tool result, which puts it on the via-Claude path. The digest itself is composed by Claude in the configured language.

## Risks / Trade-offs

- [Claude still rewrites the string] → The prompt says to copy it verbatim. The string needs no arithmetic, so a paraphrase would at worst change the wording, not the numbers.
- [Worker runs on sessions created before the window are missed, so the figures under-report] → Accepted for now and documented in the prompt module's doc comment. The line is an estimate, prefixed with `~`.
