## MODIFIED Requirements

### Requirement: Result projection via include sections

The system SHALL accept an optional `include` parameter on `find_recent_interactions` — an array whose values are drawn from `"entries"` and `"usage"`, defaulting to `["entries"]`. An empty or absent `include` SHALL be treated as `["entries"]` so the tool never returns a contentless object. The tool SHALL return a single object containing exactly the requested sections and no others:

- `"entries"` → an `entries` array of the per-session summaries (subject to `limit`/`offset` pagination and all active filters).
- `"usage"` → a `totalUsage` object aggregating the `usage` of every session that matches ALL active filters (the full matched set, not only the paginated page). "Matches all filters" includes `since`, so a window-scoped query reflects only in-window usage. The aggregate SHALL sum `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreationTokens`, and `costUsd`, treating sessions without a `usage` field as contributing zero. When the matched set is empty, `totalUsage` SHALL still be present with every component equal to `0`.

`totalUsage` SHALL additionally carry two server-computed fields so callers never do arithmetic or formatting on the components:

- `totalTokens` — the sum of `inputTokens`, `outputTokens`, `cacheReadTokens`, and `cacheCreationTokens`.
- `summary` — a human-readable string of the form `~$<costUsd to 2 decimals> · <totalTokens> tokens (<cacheReadTokens> cached)`. Token counts below 1,000 SHALL render as plain integers; counts of 1,000 or more SHALL render with three significant digits and a `K` (thousands) or `M` (millions) suffix; a value that would round to 1000 in its unit SHALL move up to the next suffix (999,999 → `1.00M`). The `(<cacheReadTokens> cached)` part SHALL be omitted when `cacheReadTokens` is `0`.

Requesting `"usage"` without `"entries"` SHALL compute and return `totalUsage` alone and SHALL NOT load, summarize, or return any entry payloads — yielding a bounded, fixed-size result regardless of how many sessions matched or how large their prompts are. This is the supported way to tally usage over a window without risking the tool-result size cap.

#### Scenario: Usage-only projection returns a bounded aggregate

- **WHEN** Claude calls `find_recent_interactions` with `include: ["usage"]`
- **THEN** the result is an object containing `totalUsage` and NO `entries` field
- **AND** `totalUsage` sums the usage of every session matching the active filters (including `since`), independent of `limit`/`offset`
- **AND** no per-session entry summaries are computed or returned, so the payload size is independent of the matched-set size

#### Scenario: Entries-only projection is the default

- **WHEN** Claude calls `find_recent_interactions` without `include` (or with `include: ["entries"]`)
- **THEN** the result is an object containing an `entries` array and NO `totalUsage` field

#### Scenario: Empty include array is treated as the default

- **WHEN** Claude calls `find_recent_interactions` with `include: []`
- **THEN** the tool treats it as the default `["entries"]` and returns an object containing an `entries` array (never a contentless object)

#### Scenario: Both sections requested

- **WHEN** Claude calls `find_recent_interactions` with `include: ["entries", "usage"]`
- **THEN** the result is an object containing both an `entries` array (paginated) and a `totalUsage` aggregate (over the full matched set)

#### Scenario: Usage-less sessions contribute zero

- **WHEN** the matched set includes sessions that have no `usage` field
- **AND** `"usage"` is in `include`
- **THEN** those sessions contribute zero to every component of `totalUsage` and do not cause an error

#### Scenario: Empty matched set returns a zero usage aggregate

- **WHEN** Claude calls `find_recent_interactions` with `"usage"` in `include` and no session matches the filters
- **THEN** the result includes `totalUsage` with every component (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreationTokens`, `costUsd`) and `totalTokens` equal to `0`
- **AND** `summary` is `~$0.00 · 0 tokens`

#### Scenario: Aggregate carries a token total and a formatted summary

- **WHEN** the matched sessions sum to input 84, output 7,378, cache read 5,093,006, cache creation 425,833, and cost 2.932
- **THEN** `totalUsage.totalTokens` is 5,526,301
- **AND** `totalUsage.summary` is `~$2.93 · 5.53M tokens (5.09M cached)`

#### Scenario: Small counts render as plain integers without a cached part

- **WHEN** the matched sessions sum to input 100, output 50, no cache tokens, and cost 0.01
- **THEN** `totalUsage.summary` is `~$0.01 · 150 tokens`

#### Scenario: Rounding up to 1000 moves to the next suffix

- **WHEN** the matched sessions sum to 999,999 total tokens (none cache reads) and cost 1.5
- **THEN** `totalUsage.summary` is `~$1.50 · 1.00M tokens`, never `1000K`

#### Scenario: Sub-cent cost renders as an approximate zero

- **WHEN** the matched sessions sum to 12,300 total tokens (none cache reads) and cost 0.003
- **THEN** `totalUsage.summary` is `~$0.00 · 12.3K tokens`
