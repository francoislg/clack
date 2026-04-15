## 1. Create shared module

- [x] 1.1 Create `src/slack/channelResolver.ts` with `openDmChannel`, `isChannelId`, `isUserId`, and `resolveChannelId`
- [x] 1.2 Implement `openDmChannel(client, userId)`: wrap `conversations.open`, log on error, return `string | null`
- [x] 1.3 Implement `isChannelId` / `isUserId` regex helpers (disjoint; C/G/D vs U)
- [x] 1.4 Implement `resolveChannelId(ctx, input)` covering all four branches: name, C/G/D passthrough, self-DM U-id, and third-party U-id rejection
- [x] 1.5 Ensure the return shape matches the existing discriminated union `{ ok: true; channelId } | { ok: false; error }`
- [x] 1.6 Create `src/slack/channelResolver.test.ts` with tests for each branch, including the self-only rule and the `conversations.open` failure path

## 2. Migrate tool call sites

- [x] 2.1 Update `src/tools/actions/scheduleReminder.ts` to import from `src/slack/channelResolver.js` and pass `ctx` instead of just `client`
- [x] 2.2 Update the `schedule_reminder` tool description to document "channel name, channel ID, or your own user ID to DM yourself"
- [x] 2.3 Update `src/tools/actions/createScheduledMessage.ts` to import from `src/slack/channelResolver.js` and pass `ctx`
- [x] 2.4 Update the `create_scheduled_message` tool description to document self-DM support
- [x] 2.5 Self-DM and third-party rejection covered by direct unit tests in `channelResolver.test.ts` AND tool-level integration tests in `scheduleReminder.test.ts` and `createScheduledMessage.test.ts` (new tests use real `WebClient` + `mock.method` to avoid the cast patterns that blocked earlier attempts)

## 3. Migrate internal DM sites

- [x] 3.1 Replace `client.conversations.open({ users })` in `src/cronScheduler.ts:notifyCreatorOfError` with `openDmChannel`
- [x] 3.2 Replace `client.conversations.open({ users })` in `src/slack/messagesApi.ts:sendDirectMessage` with `openDmChannel`
- [x] 3.3 Replace `client.conversations.open({ users })` in `src/slack/messagesApi.ts:sendErrorReport` with `openDmChannel`
- [x] 3.4 Delete the local `openDmChannel` in `src/slack/handlers/core.ts` and update `setupDmDelivery` to import from the shared module
- [x] 3.5 Replace `client.conversations.open({ users })` in `src/slack/handlers/homeTab.ts` with `openDmChannel`
- [x] 3.6 Replace `client.conversations.open({ users })` in `src/migrations/admin.ts:dmAdmin` with `openDmChannel`
- [x] 3.7 Error semantics preserved: each site still logs-and-continues (cronScheduler, homeTab, sendDirectMessage, sendErrorReport) or returns false (dmAdmin), and setupDmDelivery still falls back to thread mode when null is returned

## 4. Remove old helpers

- [x] 4.1 Delete `resolveChannelId` from `src/tools/helpers.ts`
- [x] 4.2 Delete `looksLikeSlackId` from `src/tools/helpers.ts`
- [x] 4.3 Remove `looksLikeSlackId` tests from `src/tools/helpers.test.ts`
- [x] 4.4 Keep `textResult` / `errorResult` in `src/tools/helpers.ts` (they are unrelated and still used)
- [x] 4.5 Updated `src/tools/actions/updateScheduledMessage.ts` (third tool call site discovered during `tsc`) to import from the new module

## 5. Verify

- [x] 5.1 Run `npx tsc` — no type errors
- [x] 5.2 Run `npm run test` — 2074 tests pass, including the new `channelResolver.test.ts` (21 tests)
- [x] 5.3 Grep for remaining `conversations.open({ users` — only `src/slack/channelResolver.ts:40` contains it
- [ ] 5.4 Manually verify the broken cron job in production gets recreated with a proper `D…` channel (or is deleted) — deferred to operator
