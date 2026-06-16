## 1. Capture usage in the parser

- [x] 1.1 Add a `SessionUsage` type (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreationTokens`, `costUsd`) in a shared core location (`src/claude/usage.ts`) — distinct from the plugin-facing `AskClaudeResult.usage` (narrower; core must not depend on it)
- [x] 1.2 Extend `ParsedResult` in `src/claude/messageParser.ts` with optional `usage: SessionUsage`
- [x] 1.3 Add a shared `readResultUsage(resultMessage): SessionUsage` helper (`src/claude/usage.ts`) that maps the `result` message's cumulative `usage` + `total_cost_usd` to `SessionUsage`; call it from the parser's `result` branch, leaving `usage` absent when the message carries none. (`askClaude` in `src/plugins/sdk.ts` keeps its own narrower inline read — it's a plugin and cannot import this core helper.)
- [x] 1.4 Unit test: parser threads usage from a `result` message; missing-usage result omits the field with no error (`src/claude/usage.test.ts`, `src/claude/messageParser.test.ts`)

## 2. Persist usage on SessionContext

- [x] 2.1 Add optional `usage?: SessionUsage` to `SessionContext` in `src/sessions.ts`; persisted automatically by `stripRuntimeFields` and read gracefully (absent on legacy sessions). Coordinate with the `sessions-loader-onto-zod` change to keep it a permissive optional in the zod schema.
- [x] 2.2 Persist usage at query-mode finalization in `src/claude/index.ts` (`driveRunToCompletion`), where `parser.result.usage` is in scope, via `addSessionUsage(session.sessionId, …)` — accumulates across turns. (Chosen over threading through `handlerResponse.ts`: one mechanism — `addSessionUsage` — serves both query and worker paths, and the parser result isn't available in `handlerResponse`.)
- [x] 2.3 Unit test: `addSessionUsage` round-trips/accumulates on `SessionContext` and persists to disk; legacy session JSON with no `usage` loads cleanly (`src/sessions.test.ts`)

## 3. Fold worker-run usage into the originating session

- [x] 3.1 `runClaude` returns `usage` from `parser.result.usage`; on `executeChange` completion, fold it onto the originating `SessionContext` via `addSessionUsage(sessionId, result.usage)` (the `sessionId` is already on `ExecuteChangeOptions`), treating a missing record as zero. Runs for success, failure, and no-op.
- [x] 3.2 Fold-back uses `addSessionUsage` → `withSessionLock` read-modify-write through the atomic write path, safe against the idle originating session.
- [x] 3.3 Unit test: `runClaude` surfaces usage from a result message (`src/changes/execution.test.ts`); `addSessionUsage` accumulation + disk persistence proves the worker fold-back survives the resumable record being removed (`src/sessions.test.ts`). (A full `executeChange` integration test would mock the whole worktree/git/tool stack — out of scope for a unit test; the two halves are covered separately.)

## 4. Aggregate + filters on find_recent_interactions

- [x] 4.1 Add `since` (epoch-ms lower bound on `createdAt`) to `SearchArgs` and the tool input schema; filter matched sessions by it
- [x] 4.2 Add `include_usage` (boolean) to the tool input schema
- [x] 4.3 When `include_usage` is true, compute `totalUsage` over the FULL matched set (pre-pagination), summing each component and treating usage-less sessions as zero; return `{ entries, totalUsage }`. When absent, the result shape is unchanged (bare array).
- [x] 4.4 Unit tests: `since` excludes older sessions (inclusive bound); `include_usage` returns a correct component-wise `totalUsage` independent of `limit`/`offset`; empty matched set yields a zero aggregate; usage-less sessions contribute zero (`src/tools/query/findRecentInteractions.test.ts`)

## 5. Idler summary consumption

- [x] 5.1 `src/plugins/idler/prompts/summary.ts` takes the reporting channel and instructs the digest to call `find_recent_interactions` scoped to that channel + `trigger_type: "scheduled"` + `since` window-start + `include_usage: true`, reporting a tokens/cost spend line. Wired in `src/plugins/idler/index.ts` (`buildSummaryPrompt(channel)`).
- [x] 5.2 Graceful degradation: `totalUsage` is always present (zero when empty), so the line renders from it; it is omitted only if the tool call itself fails.
- [x] 5.3 Composition with `idler-reporting-controls`: usage is captured at session finalization regardless of `tickUpdates`, so silent fires still count. Asserted via the prompt test (`src/plugins/idler/prompts/summary.test.ts`).

## 6. Validation

- [x] 6.1 `npx tsc` clean; `npx oxlint` + `npx oxfmt` clean on all touched files
- [x] 6.2 Run `npm test` (full suite, per pre-commit hook)
- [x] 6.3 `openspec validate track-session-token-usage --strict`
