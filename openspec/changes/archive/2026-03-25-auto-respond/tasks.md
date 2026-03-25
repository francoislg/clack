## 1. Rule Storage & Types

- [x] 1.1 Add `"autoRespond"` to the `TriggerType` union in `src/changes/types.ts`
- [x] 1.2 Update hardcoded `triggerType` literal unions to include `"autoRespond"` in `src/slack/activeSessions.ts` (`SessionInfo`) and `src/sessions.ts` (`SessionContext`)
- [x] 1.3 Define `AutoRespondRule` interface and `AutoRespondState` type (id, channels, userFilters, enabled)
- [x] 1.4 Create `src/autoRespond.ts` module with CRUD operations: `loadRules`, `getRules`, `addRule`, `updateRule`, `toggleRule`, `deleteRule` — file-based persistence at `data/state/auto-respond.json` with in-memory caching (same pattern as `roles.ts` / `userPreferences.ts`)

## 2. Message Event Handler

- [x] 2.1 Create `src/slack/handlers/autoRespond.ts` with `registerAutoRespondHandler(app)` — listens to `message` events, filters against active rules
- [x] 2.2 Implement message filtering: skip messages with any `subtype` (only process regular new messages), skip thread replies (`thread_ts` is set), skip own messages (bot's own user ID)
- [x] 2.3 Implement rule matching logic: channel match → user filter check (`message.user` in `userFilters`) → first matching rule wins (stop after first match)
- [x] 2.4 Extract attachments and files from matched messages using `extractAttachments()` (same as mention handler) and pass to `processMessage()`. Use fallback text "Respond this alert" when message text is empty but attachments exist
- [x] 2.5 Wrap the `processMessage()` call in a handler-level try/catch — log errors with rule ID and channel, do NOT let errors propagate to `executeAndDeliver`'s internal `handleError()` which would post to thread and DM the synthetic user
- [x] 2.6 Log successful triggers at info level with channel ID, rule ID, and message author
- [x] 2.7 Register the handler in `src/slack/app.ts` (always registered, rules control behavior)

## 3. Pipeline Adaptation

- [x] 3.1 Add early return for `"autoRespond"` in `isChangesEnabledForTrigger()` (`src/changes/detection.ts`) — return `false` before `config[triggerType]` indexing
- [x] 3.2 Handle synthetic user ID `"auto-respond"` in `getUserInfo()` (`src/slack/userCache.ts`) — return fallback `UserInfo` with displayName "Auto-Respond" without calling Slack API, cache the result
- [x] 3.3 Add `"autoRespond"` branch to `buildDeliveryContext()` in `src/claude/promptBuilder.ts` — tell Claude this is an automated response of a channel alert, not a human question; no accept/reject/send_to_thread guidance
- [x] 3.4 Handle synthetic user ID in active workers display (`src/slack/homeTab.ts`) — show "Auto-Respond" as plain text instead of `<@userId>` mention
- [x] 3.5 Pass `undefined` as `recipient_user_id` to `SlackStreamer` when userId is the synthetic `"auto-respond"` to avoid sending an invalid user ID to the Slack streaming API

## 4. Home Tab UI

- [x] 4.1 Add `buildAutoRespondSection()` to `src/slack/homeTab.ts` — admin-only section listing rules with `<#channelId>` and `<@userId>` mrkdwn formatting, Edit/Toggle/Delete buttons, plus "Add Rule" button. Show disabled rules with visual distinction.
- [x] 4.2 Create "Add Rule" modal with `multi_conversations_select` (filter: public + private channels, exclude bots) and `multi_users_select`. Channel field required, user filter optional. Include context note about bot needing to be in the channel.
- [x] 4.3 Create "Edit Rule" modal pre-populated with `initial_conversations` and `initial_users`
- [x] 4.4 Register action handlers for: add rule button → open modal, edit button → open modal, toggle button → toggle rule, delete button → delete rule
- [x] 4.5 Register view submission handlers for add and edit modals — save rule and refresh Home Tab

## 5. Testing & Verification

- [x] 5.1 Verify rule persistence: create/update/toggle/delete rules, confirm `data/state/auto-respond.json` updates correctly
- [x] 5.2 Verify message filtering: subtypes ignored, thread replies ignored, own messages ignored, first-match-wins behavior
- [x] 5.3 Verify Home Tab: rules section renders with channel/user names, modals open/save/refresh as expected, private channels selectable, extra context field works
- [x] 5.4 Verify pipeline: auto-respond sessions use user-tier instructions, responses post as thread replies, Changes Workflow is disabled, delivery context prompt is auto-respond-specific, extra context is injected
- [x] 5.5 Verify error handling: processing errors are logged but don't post to thread or attempt DM to synthetic user
- [x] 5.6 Verify streamer: `recipient_user_id` is not set to synthetic user ID
