## 1. Foundation

- [x] 1.1 Add `cron-parser` dependency (`npm install cron-parser`)
- [x] 1.2 Add `"scheduled"` to `TriggerType` in `src/changes/types.ts`
- [x] 1.3 Create `src/cronJobs.ts` — data model, CRUD operations, in-memory cache + disk persistence (following `autoRespond.ts` pattern)

## 2. Silent Thinking Delivery

- [x] 2.1 Add `silentThinking?: boolean` to `ExecuteAndDeliverParams` in `src/slack/handlers/handlerResponse.ts`
- [x] 2.2 Implement `buildDirectDeliverFn` — posts via `chat.postMessage` without `thread_ts`
- [x] 2.3 Update `executeAndDeliver` to skip `SlackStreamer` when `silentThinking` is true, use `buildDirectDeliverFn`, and pass no-op `onEvent`
- [x] 2.4 Handle error path for silentThinking (suppress channel error posting, let caller handle)

## 3. Scheduler

- [x] 3.1 Create `src/cronScheduler.ts` — tick loop (`setInterval` 60s), cron-parser matching with timezone support, concurrency guard (running flag per job)
- [x] 3.2 Implement dynamic job execution — invoke `processMessage` with `triggerType: "scheduled"`, `silentThinking: true`, creator identity
- [x] 3.3 Implement static job execution — `chat.postMessage` with `staticMessage` directly
- [x] 3.4 Implement one-shot cleanup — delete job after successful execution
- [x] 3.5 Implement error handling — DM creator on failure, update `lastRunStatus`
- [x] 3.6 Implement message attribution — prepend schedule/creator info to posted messages
- [x] 3.7 Wire scheduler start into `src/index.ts` boot sequence, stop on shutdown

## 4. Claude Tools

- [x] 4.1 Create `src/tools/actions/createScheduledMessage.ts` — validates cron expression, resolves channel, stores timezone, creates job
- [x] 4.2 Create `src/tools/query/listScheduledMessages.ts` — lists user's jobs (admin can list all)
- [x] 4.3 Create `src/tools/actions/cancelScheduledMessage.ts` — deletes job by ID with ownership check
- [x] 4.4 Register the three tools in `src/tools/server.ts`, gated by `allowScheduledMessages` config flag

## 5. Home Tab

- [x] 5.1 Add `buildScheduledMessagesSection` to `src/slack/homeTab.ts` — renders job list with role-based filtering (admin sees all, others see own)
- [x] 5.2 Wire section into `buildHomeView` in `src/slack/homeTab.ts`
- [x] 5.3 Add toggle/delete button handlers in `src/slack/handlers/homeTab.ts`

## 6. Integration & Wiring

- [x] 6.1 Disable changes workflow for `"scheduled"` trigger type in `src/changes/detection.ts`
- [x] 6.2 Update `processMessage` to accept `silentThinking` and pass it through to `executeAndDeliver`

## 7. Tests

- [x] 7.1 Unit tests for `src/cronJobs.ts` — CRUD operations, persistence
- [x] 7.2 Unit tests for `src/cronScheduler.ts` — tick matching, concurrency guard, one-shot cleanup
- [x] 7.3 Unit tests for the three Claude tools — validation, channel resolution, ownership checks
- [x] 7.4 Unit tests for `silentThinking` delivery path in `handlerResponse.ts`
- [x] 7.5 Unit tests for Home Tab scheduled messages section
