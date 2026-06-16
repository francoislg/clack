## Why

Every Claude run already reports cumulative token usage and a dollar cost in its final SDK `result` message, but Clack throws that data away (only `startupBaselineSmoke.ts` extracts it, and never persists it). As a result there is no way to answer "how many tokens did this session use?" — and, concretely, the idler plugin's morning summary cannot tell operators what the overnight autonomy actually cost. We want a general per-session usage record, with the idler summary as the first consumer.

## What Changes

- **Capture** token usage and dollar cost from each Claude run's `result` message in the shared message parser, so both query-mode and worker-mode runs are covered by one capture point.
- **Persist** a `usage` record (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreationTokens`, `costUsd`) on the durable Q&A session record (`SessionContext`). This is the general, reusable capability — usable later by the Home Tab, debugging, etc.
- **Fold worker-run usage back into its originating session.** When an `auto`-triggered `executeChange` finishes, its usage is added onto the cron/query `SessionContext` that spawned it (the worker run already knows its originating channel/thread). This makes `SessionContext` the single durable home for a session's *total* spend and sidesteps the fact that worker (resumable) session records are deleted when their PR closes.
- **Aggregate on read.** Add `include_usage: boolean` and a `since` timestamp filter to the `find_recent_interactions` tool. When `include_usage` is set, the tool sums usage server-side across the matched records and returns a `totalUsage` aggregate alongside the entries — Claude does not hand-sum.
- **Idler summary reports it.** The idler summary fire calls `find_recent_interactions` scoped to its reporting channel + `trigger_type: "scheduled"` + `since` the last summary, with `include_usage: true`, and reports a "tokens consumed · ~$cost" line in the digest.

Deliberately NOT doing: a new SDK completion hook, a separate idler usage ledger, or a clear/window cycle — the `since` filter + durable `SessionContext` make those unnecessary.

## Capabilities

### New Capabilities
- `session-token-usage`: capture per-run token/cost usage from the SDK `result` message, persist it on the durable session record, fold auto-executed worker-run usage back into the originating session, and expose a server-side aggregate over a filtered set of sessions.

### Modified Capabilities
- `find-recent-interactions`: add an optional `include_usage` flag (returns a summed `totalUsage` aggregate over matched sessions) and an optional `since` timestamp filter (lower-bound on `createdAt`).
- `idler-plugin`: the summary digest reports total tokens and approximate dollar cost consumed over the reporting window, sourced from `find_recent_interactions`.

## Impact

- **Capture/persist (core):** `src/claude/messageParser.ts` (`ParsedResult` gains usage + cost, extracted from the `result` message), `src/sessions.ts` (`SessionContext.usage` optional field — coordinate with the in-flight `sessions-loader-onto-zod` change so it lands as a permissive optional in the zod schema), the session-finalization path in `src/slack/handlers/handlerResponse.ts`.
- **Worker fold-back:** the auto-execute → `executeChange` path (`src/tools/actions/`/`src/changes/execution.ts`/`src/slack/handlers/autoExecute.ts`) writes the worker run's usage onto the originating `SessionContext` on completion.
- **Read surface:** `src/tools/query/findRecentInteractions.ts` (`include_usage`, `since`, `totalUsage` in output).
- **Idler consumption:** `src/plugins/idler/prompts/summary.ts` (digest step instructs the tokens/cost line). Composes with the in-flight `idler-reporting-controls` change (usage accumulates on the session record even when `tickUpdates: "none"`, consistent with its "ledger always recorded" principle).
- **Tests:** parser usage extraction; session persistence round-trip with usage; worker fold-back; `find_recent_interactions` aggregate + `since` filtering.
