## Context

Each Claude run's terminal SDK `result` message carries cumulative `usage` (input/output/cache tokens) and `total_cost_usd`. Today this is discarded — only `src/startupBaselineSmoke.ts:280` (`extractTotalInputTokens`) reads any of it, and nothing persists it. No surface can answer "how many tokens did this session use?", and the idler plugin's morning summary cannot report what overnight autonomy cost.

Two structural facts shape the design:

1. **One capture chokepoint.** Both query mode (`processMessage`) and worker mode (`executeChange`) iterate SDK messages through the same `ClaudeMessageParser` (`src/claude/messageParser.ts`). The `result` branch (line 231) already captures `{success, text}` but drops usage. Extracting there covers both modes with one edit.

2. **Two session stores, only one durable.** Query/cron sessions persist to `data/sessions/` as `SessionContext` (kept ~30 days, read by `find_recent_interactions`). Worker runs persist to `data/worktree-sessions/` as resumable `PersistedSessionState` — but `getResumableSessions` returns only resumable-status records, and `removeSession` deletes them when the PR closes. So a worker run whose PR merged before the morning summary is **gone**.

The idler's overnight spend spans both: a work fire runs a query session (triage/review/`propose_change`) and, via `auto`, a separate `executeChange` worker run. A correct "total tokens" must sum both, across every fire in the window.

## Goals / Non-Goals

**Goals:**
- A reusable, durable per-session usage record on `SessionContext` (general capability; future Home Tab / debugging consumers).
- The idler summary reports total tokens + approximate dollar cost over the reporting window.
- Worker-run usage counted even after its PR closes.
- No new SDK surface; no idler-side usage ledger; no clear/window cycle.

**Non-Goals:**
- Per-turn or per-tool usage breakdowns (run-level cumulative only).
- Surfacing usage in the Home Tab, `find_sessions`, or other tools now (the persisted field enables it later).
- Budgets, alerts, or throttling on usage.
- Exact cost reconciliation against Anthropic billing — `total_cost_usd` is the SDK's figure, reported as approximate.

## Decisions

### 1. Capture at the parser's `result` branch
Extend `ParsedResult` with an optional `usage: SessionUsage` (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreationTokens`, `costUsd`), populated from the `result` message's cumulative `usage` + `total_cost_usd`. One edit, both modes covered.
- *Alternative — sum `assistant`-message usage per turn (as `extractTotalInputTokens` in `startupBaselineSmoke.ts` does):* rejected. The `result` message is already cumulative and authoritative for the run, and carries cost; per-turn summing is redundant and error-prone. That helper measures a different thing (per-turn *input* size for the smoke test) and is left as-is.

**Reuse note.** `askClaude` (`src/plugins/sdk.ts:1164-1182`) already reads the `result` message's `input_tokens`/`output_tokens` inline. To avoid a third copy of the result-usage read, factor a small shared `readResultUsage(resultMessage): SessionUsage` helper in core and use it in the parser; `askClaude` may adopt it later (out of scope here). `SessionUsage` is a NEW core type — distinct from the plugin-facing `AskClaudeResult.usage` (a narrower 2-field shape); core must not depend on the plugin type, and `SessionUsage` is a superset, so they stay separate.

### 2. Durable home is `SessionContext`; fold worker usage back into it
Persist `usage` on `SessionContext`. When an `auto`-triggered `executeChange` completes, add its usage component-wise onto the originating `SessionContext`. The originating cron/query session becomes the single durable home for the session's TOTAL spend.

The originating-session context is **already reachable** — no new threading is required: `ExecuteChangeOptions` already carries `sessionId` (and `request.channel`/`request.threadTs`), and the auto-execute path (`changeAction.ts`) passes `session.sessionId` through `startChangeWorkflow` → `executeChange`. The fold-back is therefore a write on completion, not a plumbing change. Accumulation treats a missing record on either side as zero: `component = (existing ?? 0) + (worker ?? 0)`.
- *Alternative — query the worker store at summary time:* rejected. Worker records are deleted on PR close, so the morning summary would undercount any already-merged work. Fold-back is immune.
- *Alternative — SDK completion hook (push) + idler accumulator file:* rejected. Adds SDK surface, an idler ledger, and a clear/window cycle. The fold-back + `since` filter achieve the same with strictly less new surface, and the fold-back is internal to core (not an SDK contract).

### 3. Aggregate server-side via `include_usage` on `find_recent_interactions`
Add `include_usage: boolean` and a `since` epoch-ms filter. When `include_usage` is true, the tool sums `usage` across the full matched set (not just the paginated page) and returns `totalUsage`. Claude never hand-sums.
- *Alternative — return raw per-session usage and let Claude sum:* rejected. Summing N records in-prompt is non-deterministic and drifts; server-side summation is exact.
- *Alternative — a dedicated idler MCP tool:* rejected. The aggregation must read core session files, which plugin code cannot (plugin boundary). Reusing the core `find_recent_interactions` tool keeps the read inside core and serves every caller.

### 4. Idler scopes by channel + trigger type + `since`
The summary fire calls `find_recent_interactions({ channel: reportingChannel, trigger_type: "scheduled", since: <window start>, include_usage: true })` and reports `totalUsage`. The `since` window replaces any clear/reset cycle; no idler state is added.

## Risks / Trade-offs

- **Late worker runs cross the window boundary.** A work fire at 08:45 whose `executeChange` is still running at the 09:00 summary lands its usage in the *next* window. → Accept as defined behavior; the fold-back still records it durably, so nothing is lost, only shifted.
- **Channel scoping ambiguity.** If another scheduled job posts to the same `reportingChannel`, its sessions would be counted. → In practice the reporting channel is idler-dedicated; if needed later, a `job_id` filter on `find_recent_interactions` tightens this. Out of scope now.
- **`SCAN_LIMIT`/30-day prune could drop window sessions.** → The idler window is hours, far inside both bounds; not a practical risk.
- **Fold-back write contention.** The worker fold-back is a read-modify-write on the originating `SessionContext`. → Reuse the existing atomic session-write path (`updateSessionUnlocked`/`writeContextAtomic`); the originating session is idle (its turn already finalized) when the async worker completes, so contention is minimal.
- **Coordination with in-flight changes.** The `usage?` field must land as a permissive optional in the session loader — coordinate with `sessions-loader-onto-zod`. Composes with `idler-reporting-controls`: usage accrues on the session record even on silent `tickUpdates: "none"` fires, matching its "ledger always recorded" principle.

## Migration Plan

No data migration. `usage` is an optional field: sessions persisted before this change load with `usage` absent (graceful reader), and the aggregate treats them as zero. Rollback is removing the field readers; persisted `usage` values are simply ignored by older code.

## Open Questions

- None blocking. A future `job_id` filter on `find_recent_interactions` is the natural tightening if multiple scheduled jobs ever share the idler's reporting channel.
