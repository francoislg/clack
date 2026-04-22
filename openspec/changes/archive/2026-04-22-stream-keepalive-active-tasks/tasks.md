## 1. Active task tracking

- [x] 1.1 Add `activeTasks: Map<string, { startedAt: number; baseTitle: string | undefined; isGroup: boolean; tickCount: number }>` field to `SlackStreamer` (baseTitle is snapshotted lazily at the first decoration tick; see 2.3)
- [x] 1.2 Add `lastEventAt: number` and `lastKeepaliveTickAt: number` fields, both initialized to `Date.now()` at the end of `start()` (after the initial append succeeds)
- [x] 1.3 In `handleEvent` for `tool_start` (new task): insert entry into `activeTasks` with `startedAt = now`, `baseTitle = undefined`, `isGroup`, `tickCount = 0`
- [x] 1.4 In `handleEvent` for `tool_start` (joining a group): do NOT reset `startedAt` on the group's existing entry; `baseTitle` stays as-is (will be refreshed at tick time if needed)
- [x] 1.5 In `handleEvent` for `tool_end` that marks the task `complete` (standalone, or group with `pending === 0`): remove the entry from `activeTasks`
- [x] 1.6 Update `lastEventAt = Date.now()` at the top of `handleEvent` for real tool events

## 2. New keepalive content strategy

- [x] 2.1 Add a `VISIBLE_PROGRESS_THRESHOLD_MS = 30_000` constant
- [x] 2.2 Add a `fmtElapsed(ms: number): string` helper — `45s` for `< 60s`, `1m 5s` for `60s–599s`, `15m` for `>= 600s` (drop seconds when minutes ≥ 10)
- [x] 2.3 Replace the keepalive tick body: iterate `activeTasks`; for each entry with `elapsed >= VISIBLE_PROGRESS_THRESHOLD_MS`, lazily snapshot `baseTitle` if `undefined` (see 2.4), then emit a `task_update` chunk with `title: "{baseTitle} :stopwatch: {fmtElapsed(elapsed)}"` and `details: tickCount === 0 ? "\n ." : " ."`, then increment `tickCount`
- [x] 2.4 `baseTitle` snapshot timing: for standalone tasks, capture the task's current label from `taskLabels`; for grouped tasks, re-derive `groupTitle(openGroup)` at every tick (so the count suffix `(N)` stays current as items join). The snapshot happens at first decoration tick (after threshold), not at tool_start
- [x] 2.5 When `activeTasks` is empty, still emit a `task_update` chunk on `THINKING_TASK_ID` with the current thinking task title and `in_progress` status (preserves today's pre-first-tool dead-zone coverage)
- [x] 2.6 Update `lastKeepaliveTickAt = Date.now()` at the start of each tick
- [x] 2.7 Verify the keepalive timer is still cleared in both `stop()` and in the `append()` catch block when `failed` transitions to `true` (existing behavior — add an explicit test in 4.x to catch regressions)

## 3. Enriched failure diagnostics

- [x] 3.1 In `append()` catch block at `slackStreamer.ts:402-419`, build a diagnostic object `{ msSinceLastTick: now - lastKeepaliveTickAt, msSinceLastEvent: now - lastEventAt, activeTaskCount: activeTasks.size }` and include it in the existing warn log for `message_not_in_streaming_state`
- [x] 3.2 Apply the same enrichment to the warn log in `stop()` at `slackStreamer.ts:334-338`

## 4. Tests

- [x] 4.1 Update existing "keepalive" test block: assert that during tool execution the keepalive emits `task_update` chunks on the in-progress tasks (not rotating dots on the thinking task), and that the thinking task is only pinged when no tasks are active
- [x] 4.2 Add test: single standalone task running past 30s → receives one `task_update` per tick with growing elapsed and appending dots (first tick `"\n ."`, subsequent ticks `" ."`)
- [x] 4.3 Add test: task completing before 30s threshold → no decoration emitted
- [x] 4.4 Add test: two parallel standalone tasks, one past threshold and one under → only the long-running task is decorated; verify independence of timers
- [x] 4.5 Add test: grouped task receives decoration with current group title (including `(N)` suffix) as base; when a new item joins mid-decoration, next tick reflects the new count
- [x] 4.6 Add test: joining a group does not reset `startedAt`
- [x] 4.7 Add test: no active tasks → keepalive still pings the thinking task (preserves pre-first-tool coverage)
- [x] 4.8 Add test: `message_not_in_streaming_state` during mid-flight append logs warn with `msSinceLastTick`, `msSinceLastEvent`, `activeTaskCount` fields
- [x] 4.9 Add test: `fmtElapsed` outputs expected forms: `45s` for `< 60s`, `1m 5s` for `60s`–`599s`, `15m` for `>= 600s` (seconds dropped when minutes ≥ 10), `15m` for exactly `15m 30s`
- [x] 4.10 Add test: keepalive timer is cleared when `stop()` is called and when an append fails with `message_not_in_streaming_state`

## 5. Manual verification

- [x] 5.1 Run `npx tsc` — no type errors
- [x] 5.2 Run `npm run test` — all streaming tests pass
- [x] 5.3 Deploy to staging / local run, trigger a worker run that includes a ≥30s tool call, verify the Slack plan view shows `:stopwatch: {time}` in the title and appending dots in the details
- [x] 5.4 If a `message_not_in_streaming_state` occurs post-deploy, inspect the container logs to confirm the warn line includes the three new diagnostic fields
