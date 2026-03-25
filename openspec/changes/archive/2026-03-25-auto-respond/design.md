## Context

Clack has three human-initiated trigger modes (reactions, DMs, mentions) that all funnel through `processMessage()` in `src/slack/handlers/core.ts`. Each trigger mode has its own handler that extracts message content and calls `processMessage()` with a `triggerType`.

The auto-respond feature adds a 4th trigger mode that fires automatically when messages from specific apps/users appear in watched channels. It reuses the existing `processMessage()` pipeline — the only difference is *who* initiates the response.

Runtime state is stored in `data/state/` (e.g., `roles.json`, `user-preferences.json`) with in-memory caching and file-based persistence. Auto-respond rules follow this same pattern.

## Goals / Non-Goals

**Goals:**
- Admins can create rules that automatically trigger Clack responses on matching messages
- Rules are manageable from the Home Tab (create, edit, toggle, delete)
- The response flow reuses `processMessage()` with minimal adaptation
- Rules persist across restarts

**Non-Goals:**
- Rate limiting / deduplication (keep simple for v1)
- Custom instructions per rule (uses standard user-tier instructions)
- Repository pinning per rule (Claude determines relevant repos from context)
- Changes Workflow support for auto-respond (read-only responses only)
- Pattern matching on message content (filter by channel and user/bot only)

## Decisions

### Rule storage: `data/state/auto-respond.json`

Rules live in `data/state/auto-respond.json`, following the same pattern as `roles.json` and `user-preferences.json`: file-based persistence with in-memory cache, loaded lazily on first access.

**Why not `config.json`?** Config is deploy-time infrastructure. Rules are admin-managed runtime state — they're created, edited, and deleted from Slack. The `data/state/` pattern is exactly this.

**Why not a database?** Clack has no database. All state is file-based. Rules are small (tens of entries at most) and change infrequently — a JSON file is sufficient.

### Event handling: `message` event listener with early filtering

Register an `app.message()` handler that receives all messages in channels where the bot is a member. The handler:

1. Loads active rules (from cache)
2. Checks if the message's channel matches any rule
3. If channel matches, checks user/bot filters (if any)
4. If a rule matches, calls `processMessage()`

The filter is cheap (in-memory map lookup by channel ID). The bot already needs to be in channels to receive events — no new Slack scopes needed beyond what mentions/reactions already require.

**Alternative considered:** Slack's Events API filter. Rejected because it can't filter by bot_id at the subscription level — you'd still need app-side filtering.

### User identity: synthetic `"auto-respond"` constant

Sessions created by auto-respond use the string `"auto-respond"` as the userId. This means:
- Role resolution returns `"member"` (no entry in roles.json) → user-tier instructions apply
- Session IDs include this constant, making them identifiable
- The Home Tab "Active Workers" section can display "Auto-respond" instead of a user name

**Alternative considered:** Using the posting bot's user ID. Rejected because it conflates the trigger source with the session owner, and role lookups for bot IDs would be meaningless.

### Trigger type: add `"autoRespond"` to `TriggerType` with config indexing fix

Extend `TriggerType = "directMessages" | "mentions" | "reactions" | "autoRespond"`. This flows through to:
- `processMessage()` for trigger-specific behavior
- Config lookup for changes workflow toggle (auto-respond: always disabled)
- Session context for identification

**Critical**: `isChangesEnabledForTrigger()` currently does `config[triggerType]` to access trigger-specific config. Since `"autoRespond"` is not a key on `Config`, this needs an early return for `"autoRespond"` before the indexing. Similarly, `SessionInfo.triggerType` in `activeSessions.ts` and `SessionContext.triggerType` in `sessions.ts` use hardcoded literal unions — not the `TriggerType` alias. Both need updating to include `"autoRespond"`.

### Message filtering: top-level messages only, no subtypes

The `message` event fires for everything: new messages, edits, deletes, joins, thread replies. The handler must filter aggressively:
- **Skip subtypes**: Only process messages with no `subtype` (regular new messages). This excludes `message_changed`, `message_deleted`, `channel_join`, `bot_message`, etc.
- **Skip thread replies**: Only process messages where `thread_ts` is undefined. Thread replies (including Clack's own responses) would otherwise re-trigger responses.
- **First match wins**: If multiple rules match a message, trigger exactly once. Rules are evaluated in order; first match short-circuits.

### Message text: use full message content as response prompt

The handler passes the full message text (plus any attachments/blocks content) to `processMessage()` as the `messageText`. A specific delivery context prompt tells Claude this is an automated response of a channel alert, not a human question.

### Delivery context: auto-respond-specific prompt

`buildDeliveryContext()` in `promptBuilder.ts` needs an `"autoRespond"` branch that tells Claude:
- This is an automated response triggered by a channel alert
- The message content is an alert/notification to respond, not a human asking a question
- No `accept`/`reject`/`send_to_thread` actions apply

### Error handling: handler-level catch before the pipeline

Unlike human-initiated triggers where errors can surface to the user, auto-respond errors must be caught at the handler level — before `executeAndDeliver`'s internal `handleError()` which unconditionally posts error blocks to the thread and attempts a DM. The auto-respond handler wraps the entire `processMessage()` call in a try/catch, logging the error with rule/channel context. This prevents both thread-posted errors and DM attempts to the synthetic user ID.

### Streamer: skip `recipient_user_id` for synthetic user

`SlackStreamer` passes `userId` as `recipient_user_id` to the Slack chat streaming API. For auto-respond, the synthetic `"auto-respond"` string is not a valid Slack user ID. The streamer should receive `undefined` instead, which it already handles (conditional spread).

### Home Tab: new section for admin rule management

Add an "Auto-Respond" section to the Home Tab, visible to admins only (same gate as role management). The section lists current rules with edit/toggle/delete controls and an "Add Rule" button that opens a modal.

The modal uses:
- `multi_conversations_select` with filter `{ include: ["public", "private"], exclude_bot_users: true }` for channel selection. `multi_channels_select` was rejected because it only shows public channels — `multi_conversations_select` with a filter supports both public and private channels and has documented `initial_conversations` for pre-population in the edit modal.
- `multi_users_select` for user/bot filtering (native Slack element — includes both humans and bots)
- The enable/disable toggle is on the rule list, not in the modal
- A context note reminding admins the bot must be a member of selected channels
- Rule display uses `<#channelId>` and `<@userId>` mrkdwn formatting (Slack resolves to names, zero API calls)

### Handler registration: always register, rules control activation

The `message` event handler is always registered (like reaction handlers), but does nothing when no rules exist or all rules are disabled. This avoids needing a config flag to enable/disable the feature — the rules themselves are the configuration.

## Risks / Trade-offs

**[Volume] Auto-respond processes every matching message** → For v1, this is acceptable. Chatty channels could generate many concurrent responses. If this becomes a problem, future work can add cooldown periods or deduplication. The handler should log when it triggers so operators can monitor volume.

**[Bot must be in channel] The bot needs to be a member of watched channels** → The admin creating a rule is responsible for ensuring the bot is in the channel. The UI could validate this at rule creation time by checking `conversations.info`, but for v1, a simple note in the modal is sufficient.

**[No user context] Sessions have no real user for identity features** → Features like `fetchUserNames`, DM delivery preferences, and role-based tool gating don't apply. The synthetic user ID should be handled gracefully in these paths (no-op for user lookups, member-level permissions).

**[Message event noise] Handler receives all channel messages** → The filter is an O(1) channel-set lookup, so the overhead per non-matching message is negligible. But the bot will receive events it previously didn't (all messages in watched channels vs. only mentions/reactions). This is inherent to the feature.
