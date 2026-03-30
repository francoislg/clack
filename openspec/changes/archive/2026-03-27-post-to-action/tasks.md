## 1. Rename send_to_thread → post_to (types and schema)

- [x] 1.1 Rename `SendToThreadAction` → `PostToAction` in `src/tools/types.ts`, update the `Action` union
- [x] 1.2 Rename `sendToThreadActionSchema` → `postToActionSchema` in `src/tools/presentation/submitResponse.ts`, change `z.literal("send_to_thread")` → `z.literal("post_to")`
- [x] 1.3 Update snapshot persistence loop in `submitResponse.ts` to check for `type === "post_to"`

## 2. Rename in block rendering and button handlers

- [x] 2.1 Update `getActionId()` in `src/slack/blocks.ts` to return `"clack_post_to"` for the `post_to` type
- [x] 2.2 Update `actionToButton()` default label from "Send to thread" to the appropriate label for `post_to`
- [x] 2.3 Update button handler registration in `src/slack/handlers/dmActions.ts` — register `clack_post_to_\d+` regex, keep `clack_dm_send_to_thread_\d+` for backward compat (both route to the same handler)
- [x] 2.4 Rename `handleSendToThread` → `handlePostTo` in `dmActions.ts`

## 3. Implement post_to auto-execute

- [x] 3.1 Export `postAnswerToChannel` and `resolveOrigin` from `src/slack/handlers/dmActions.ts`
- [x] 3.2 Add `post_to` auto-execute handler at the top of `handleAutoExecuteActions` in `src/slack/handlers/autoExecute.ts`, before the `stagedIntents` and role guards
- [x] 3.3 Implement snapshot lookup: load session via `getSession(sessionId)`, read `session.snapshots[snapshotId]`
- [x] 3.4 Implement target resolution: use exported `resolveOrigin` + fallback chain (explicit → origin → assistant → session channel)
- [x] 3.5 Skip auto-execute when `triggerType` is `"directMessages"` (non-assistant) or `"autoRespond"`
- [x] 3.6 Post snapshot content via `postAnswerToChannel`, error handling follows existing auto-execute pattern (catch + post error to thread)

## 4. Update instructions and delivery context

- [x] 4.1 Update `buildDeliveryContext()` in `src/claude/promptBuilder.ts` — rename `send_to_thread` references to `post_to`, add "in the channel" guidance for Thread/Mention/Assistant modes
- [x] 4.2 Update `data/default_configuration/user/submit-response.md` — rename `send_to_thread` to `post_to`, document the "in the channel" pattern (`post_to` with `auto: true`, no `thread_ts`)

## 5. Migration

- [x] 5.1 Create a new boot migration that renames `send_to_thread` → `post_to` in instruction override files (session backward compat handled via dual regex pattern)

## 6. Tests

- [x] 6.1 Update `src/tools/presentation/submitResponse.test.ts` — rename `send_to_thread` → `post_to` in all test cases
- [x] 6.2 Update `src/slack/handlers/autoExecute.test.ts` — add test cases for `post_to` auto-execute (snapshot lookup, target resolution, skip for DM/auto-respond)
- [x] 6.3 Update `src/slack/handlers/dmActions.test.ts` — rename references, verify backward compat handler
- [x] 6.4 Update `src/slack/blocks.test.ts` — rename `send_to_thread` → `post_to` in block rendering tests
- [x] 6.5 Update `src/claude/promptBuilder.test.ts` — rename `send_to_thread` → `post_to` in delivery context tests
- [x] 6.6 Run `npx tsc` and `npm test` to verify all changes compile and pass
