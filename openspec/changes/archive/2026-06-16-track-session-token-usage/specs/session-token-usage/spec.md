## ADDED Requirements

### Requirement: Capture per-run token and cost usage

The system SHALL extract token usage and dollar cost from each Claude run's terminal SDK `result` message and surface it on the parser's `ParsedResult`. The captured usage SHALL include `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreationTokens`, and `costUsd`, taken from the `result` message's cumulative `usage` and `total_cost_usd` fields. Because both query-mode and worker-mode runs drain through the same message parser, this single capture point SHALL cover both.

#### Scenario: Usage extracted from a successful run

- **WHEN** a Claude run completes and emits a `result` message carrying `usage` and `total_cost_usd`
- **THEN** the parser's `ParsedResult` includes a `usage` record with `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreationTokens`, and `costUsd` populated from that message

#### Scenario: Result message without usage

- **WHEN** a `result` message arrives with no usage data (or an error subtype carrying none)
- **THEN** the parser's `ParsedResult.usage` is left undefined and no error is raised

### Requirement: Persist usage on the durable session record

The system SHALL persist the captured usage onto the Q&A session record (`SessionContext`) as an optional `usage` field when a session is finalized. The field SHALL be modeled as an optional, permissive value in the session loader (graceful reader): a session persisted before this change, or one whose run reported no usage, SHALL load without error and with `usage` absent.

#### Scenario: Usage written on session finalization

- **WHEN** a query-mode session finalizes with a `ParsedResult` carrying usage
- **THEN** the persisted `SessionContext` for that session records the `usage` field

#### Scenario: Legacy session without usage loads cleanly

- **WHEN** a `SessionContext` persisted before this change (no `usage` field) is read
- **THEN** it loads successfully with `usage` absent and no validation failure

### Requirement: Fold worker-run usage into the originating session

When an `auto`-triggered change execution (`executeChange`) completes, the system SHALL add that worker run's captured usage to the `usage` record of the `SessionContext` that spawned it, accumulating component-wise (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreationTokens`, `costUsd`). Each accumulated component SHALL be computed as `(existing ?? 0) + (worker ?? 0)`, so a missing `usage` record on either side is treated as zero. This makes the originating durable session the single home for a session's TOTAL spend, independent of the worker (resumable) session record, which is deleted when its PR closes.

#### Scenario: Auto-executed worker usage accrues to the originating session

- **WHEN** a cron/query session calls `propose_change` with `auto`, and the resulting `executeChange` worker run completes with usage
- **THEN** the worker run's usage is added component-wise onto the originating `SessionContext.usage`

#### Scenario: Originating session has no prior usage record

- **WHEN** a worker run's usage is folded into an originating session that has no `usage` record (e.g. a legacy session, or one whose own run reported no usage)
- **THEN** the originating session's `usage` is initialized to the worker run's usage (the missing record is treated as zero)

#### Scenario: Worker usage survives PR closure

- **WHEN** the worker (resumable) session record for an auto-executed change has been deleted after its PR closed
- **THEN** that run's usage remains recorded on the originating `SessionContext` and is still countable

### Requirement: Server-side usage aggregation over a filtered session set

The system SHALL provide a way to compute a summed usage aggregate over a filtered set of persisted sessions, server-side, so that consumers receive a precomputed `totalUsage` rather than summing individual records themselves. The aggregate SHALL sum each usage component across the matched sessions and SHALL treat sessions without a `usage` field as contributing zero.

#### Scenario: Aggregate sums matched sessions

- **WHEN** a usage aggregate is requested over a set of matched sessions
- **THEN** the returned `totalUsage` is the component-wise sum of every session in the set, independent of any pagination applied to the returned entries, with usage-less sessions contributing zero

#### Scenario: Empty set aggregates to zero

- **WHEN** a usage aggregate is requested over an empty set
- **THEN** `totalUsage` is returned with every component equal to `0`
