## Context

Claude can read reactions on messages (message-reactions-context change) but cannot add or remove them. Slack provides `reactions.add` and `reactions.remove` API methods. Several existing tools already parse Slack message URLs via `parseSlackMessageUrl` (exported from `fetchSlackMessage.ts`).

The tool server registers tools gated by `ctx.slackClient` presence. Tools available to all roles are added unconditionally within the slackClient block (like `fetch_slack_message`, `fetch_channel_messages`).

## Goals / Non-Goals

**Goals:**
- Let Claude add and remove emoji reactions on any message it can identify (by channel+ts or URL)
- Available to all roles — reactions are low-risk, visible, and easily reversible
- Reuse existing URL parsing infrastructure

**Non-Goals:**
- Bulk reaction management (add multiple emojis in one call — Claude can call the tool multiple times)
- Reaction-based workflows (polls, approvals) — those are instruction-level concerns, not tool concerns

## Decisions

### Two separate tools instead of one

`add_reaction` and `remove_reaction` rather than a single `manage_reaction` with an action parameter. This makes intent explicit in tool calls and gives Claude clearer affordances — it sees two distinct capabilities rather than one with a mode switch.

### Message targeting: channel_id + message_ts OR url

Both tools accept either:
- `channel_id` + `message_ts` (direct — used when Claude already has these from context)
- `url` (Slack message URL — used when the user pastes a link)

At least one of `url` or (`channel_id` + `message_ts`) must be provided. URL is parsed via the existing `parseSlackMessageUrl` from `fetchSlackMessage.ts`.

### Emoji name parameter

The `emoji` parameter accepts the emoji name without colons (e.g., `thumbsup` not `:thumbsup:`). This matches the Slack API convention and avoids Claude needing to strip colons.

### Error handling

Slack API returns specific error codes for reaction operations:
- `already_reacted` — the bot already reacted with this emoji (for add)
- `no_reaction` — the bot hasn't reacted with this emoji (for remove)
- `invalid_name` — emoji doesn't exist
- `message_not_found` — message doesn't exist
- `channel_not_found` — channel doesn't exist

The tools return user-friendly error messages for these cases. `already_reacted` and `no_reaction` are treated as success (idempotent) rather than errors.

### Tool labels

Both tools get label mappings in `data/default_configuration/tool-labels/`. Labels include the emoji name for clarity (e.g., "Adding :thumbsup: reaction").
