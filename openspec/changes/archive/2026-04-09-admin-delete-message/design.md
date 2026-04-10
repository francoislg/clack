## Context

Clack posts messages to Slack via `chat.postMessage` and `chat.postEphemeral`. Admins currently have no programmatic way to remove these messages. The Slack API provides `chat.delete` for non-ephemeral messages, but only for messages the calling bot posted. This change adds an `admin_delete_message` tool that wraps this capability with ownership verification.

Existing infrastructure to reuse:
- `parseSlackMessageUrl()` in `src/tools/query/fetchSlackMessage.ts` already parses Slack permalinks into `{ channelId, messageTs, threadTs? }`
- `chat.delete` pattern already used in `src/slack/handlers/handlerResponse.ts`
- Admin tool pattern established in `src/tools/admin/`
- `canEditConfig()` permission guard for admin+ gating

## Goals / Non-Goals

**Goals:**
- Let admin+ users delete any message Clack posted, by URL
- Verify ownership before deletion (fetch the message, confirm `bot_id` matches Clack's)
- Return a helpful error for ephemeral messages (not found in history) and non-Clack messages
- Support both top-level messages and thread replies

**Non-Goals:**
- Deleting messages posted by other users or bots
- Bulk deletion
- Deleting ephemeral messages (Slack API does not support this)

## Decisions

### Fetch-first ownership verification
Before calling `chat.delete`, fetch the message and verify `bot_id` matches Clack's bot ID (obtained via `auth.test()`).

**Why:** `chat.delete` returns `cant_delete_message` for non-owned messages, which is an opaque error. A pre-check gives a clear message: "That message wasn't posted by me."

**Alternative considered:** Let the API fail naturally. Rejected — the error is ambiguous between "not my message", "already deleted", and other cases.

### Ephemeral detection via fetch failure
Ephemeral messages (`chat.postEphemeral`) don't appear in `conversations.history` or `conversations.replies`. If the fetch returns no message, the tool returns: "Message not found. If this was an ephemeral message, those cannot be deleted via the API."

**Why:** There is no Slack API to delete ephemeral messages after they're sent. The best we can do is explain the limitation rather than silently failing.

### Thread reply vs top-level detection
If the URL contains `thread_ts` in query params, fetch via `conversations.replies(channel, thread_ts)` and find the specific reply by `ts`. Otherwise, fetch via `conversations.history(channel, oldest=ts, latest=ts, inclusive=true)`.

This reuses the same logic already embedded in `parseSlackMessageUrl`.

### Bot identity via `auth.test()`
Clack's `bot_id` is obtained by calling `slackClient.auth.test()`. This result can be cached per-tool invocation (it's a single cheap call).

**Alternative considered:** Hardcode the bot ID from config. Rejected — fragile if the bot is reinstalled or workspace changes.

### Registration gate: `canEditConfig` + `ctx.slackClient`
Tool is registered inside the existing `canEditConfig(ctx.role)` block and additionally guarded by `ctx.slackClient` presence, consistent with how other Slack-dependent query tools are registered.

## Risks / Trade-offs

**[Risk] Race condition between fetch and delete** → Between ownership check and deletion, the message could be deleted by another admin. Mitigation: `chat.delete` will return `message_not_found`; surface as "Message was already deleted."

**[Risk] `conversations.history` requires channel membership** → The bot must be a member of the channel to fetch message history. If Clack is not in the channel, the fetch will fail with `not_in_channel`. Mitigation: surface the API error with a note that Clack must be a member of the channel.

**[Risk] Ephemeral messages silently look like "not found"** → We can't distinguish "message never existed", "already deleted", and "ephemeral" via the history API. Mitigation: return the most helpful possible message that covers all three cases.
