## ADDED Requirements

### Requirement: Filter by minimum creation time

The system SHALL accept an optional `since` parameter on `find_recent_interactions` — an epoch-millisecond lower bound on `createdAt`. When provided, only sessions created at or after `since` are returned. This lets a caller scope results to a time window (e.g. an idler reporting window) without paging.

#### Scenario: Sessions before `since` are excluded

- **WHEN** Claude calls `find_recent_interactions` with a `since` timestamp
- **THEN** only sessions whose `createdAt >= since` are returned
- **AND** all other filters (channel, trigger type, privacy) still apply

#### Scenario: No `since` returns the full recent window

- **WHEN** Claude calls `find_recent_interactions` without `since`
- **THEN** results are not bounded below by creation time (existing behavior)

### Requirement: Optional usage aggregate

The system SHALL accept an optional `include_usage` boolean on `find_recent_interactions`. When `true`, the tool SHALL compute, server-side, a `totalUsage` aggregate summing the `usage` of every session that matches ALL active filters (the full matched set, not only the paginated page), and return it alongside the entries. "Matches all filters" includes `since` — when `since` is provided the aggregate sums only in-window sessions, so a window-scoped query reflects only in-window usage. The aggregate SHALL sum `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreationTokens`, and `costUsd`, treating sessions without a `usage` field as contributing zero. When the matched set is empty, `totalUsage` SHALL still be present with every component equal to `0` (distinguishing "queried, none found" from "not requested"). When `include_usage` is absent or `false`, the result shape is unchanged.

#### Scenario: Aggregate returned when requested

- **WHEN** Claude calls `find_recent_interactions` with `include_usage: true`
- **THEN** the result includes a `totalUsage` object with the component-wise sum of the matched sessions' usage
- **AND** the aggregate covers all sessions matching the filters, independent of `limit`/`offset` pagination

#### Scenario: Aggregate omitted by default

- **WHEN** Claude calls `find_recent_interactions` without `include_usage` (or with `false`)
- **THEN** no `totalUsage` is included and the result shape matches prior behavior

#### Scenario: Usage-less sessions contribute zero

- **WHEN** the matched set includes sessions that have no `usage` field
- **THEN** those sessions contribute zero to every component of `totalUsage` and do not cause an error

#### Scenario: Empty matched set returns a zero aggregate

- **WHEN** Claude calls `find_recent_interactions` with `include_usage: true` and no session matches the filters
- **THEN** the result includes `totalUsage` with every component (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreationTokens`, `costUsd`) equal to `0`
- **AND** the entries array is empty
