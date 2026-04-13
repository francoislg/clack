## Context

Slack's `conversations.replies()` and `conversations.history()` APIs return a `reactions` array on each message:

```ts
message.reactions = [
  { name: "thumbsup", count: 3, users: ["U123", "U456", "U789"] },
  { name: "eyes", count: 1, users: ["U321"] }
]
```

Clack currently discards this data. Two independent pipelines process messages:

1. **`fetchThreadContext()`** in `messagesApi.ts` — returns `ThreadMessage[]`, used by `core.ts` (session startup), `retry.ts`, and the `fetch_slack_message` tool
2. **`formatMessage()`** in `fetchChannelMessages.ts` — returns `Record<string, unknown>`, used only by `fetch_channel_messages`

Both pipelines extract text, blocks, attachments, images, files, and resolve user IDs. They do the same work independently.

## Goals / Non-Goals

**Goals:**
- Surface message reactions in Claude's thread context (system prompt) with resolved usernames
- Surface reactions in `fetch_slack_message` and `fetch_channel_messages` tool output
- Unify per-message extraction so enrichment only happens once

**Non-Goals:**
- Dedicated reactions API tool (existing tools cover re-fetching)
- Filtering out bot reactions or trigger reactions
- Reaction-based commands or analytics

## Decisions

### 1. Reaction data model

Add a `MessageReaction` type to `sessions.ts`:

```ts
interface MessageReaction {
  emoji: string;       // e.g. "thumbsup"
  userIds: string[];   // raw Slack user IDs
  usernames?: string[];  // resolved display names (when fetchUserNames is true)
}
```

`usernames` is optional — only populated when `fetchUserNames` is enabled (same gate as message author resolution). This keeps the type consistent with the existing pattern where username resolution is opt-in.

**Alternative considered**: Storing reactions as a flat string (`:thumbsup: by @alice`). Rejected because structured data is more useful for tool output and allows different formatting per consumer.

### 2. Extract shared message building into a function

Extract the per-message extraction logic from `fetchThreadContext()` into a standalone function (e.g. `buildThreadMessage()`) that takes a raw Slack message and returns a `ThreadMessage`. This function handles: text extraction, block/attachment mapping, image/file extraction, and reaction extraction.

`fetchChannelMessages` then calls this shared function instead of its own `formatMessage()`. It keeps its own responsibilities: thread reply expansion, channel-level pagination, and output shaping for the tool response.

**Alternative considered**: Making `fetchChannelMessages` call `fetchThreadContext()` directly. Rejected because `fetchThreadContext()` bundles the API call (`conversations.replies`) with the extraction — we need to split these concerns. `fetchChannelMessages` uses `conversations.history` with different parameters.

### 3. User resolution for reactions

Reaction user IDs are resolved using the existing `resolveUsers()` call. The reactor user IDs are collected alongside message author IDs into a single batch resolve call, so there's no additional API round-trip cost — the user cache handles deduplication.

### 4. Prompt formatting

Reactions are appended as a `[reactions: ...]` line, matching the existing pattern for attachments, images, and files:

```
[Alice]: Can we deploy this today?
[reactions: :thumbsup: by @bob, @charlie; :eyes: by @dave]
```

Messages with no reactions get no extra line (no `[reactions: none]`).

### 5. Tool output format

Both `fetch_slack_message` and `fetch_channel_messages` include reactions as a structured array:

```json
{
  "reactions": [
    { "emoji": "thumbsup", "users": ["alice", "bob"] },
    { "emoji": "eyes", "users": ["charlie"] }
  ]
}
```

Omitted when no reactions exist (consistent with how images/files are handled).

## Risks / Trade-offs

- **Extra user resolution calls**: Reactors may include users not in the message thread. The existing user cache mitigates this — most reactors are likely thread participants already resolved. Risk is low.
- **Larger prompt context**: Heavily-reacted messages add text to the system prompt. This is bounded — Slack caps reactions at 23 distinct emojis per message, and the user list per emoji is typically small.
- **`fetchChannelMessages` refactor scope**: Unifying the extraction path touches a well-tested tool. The refactor should preserve identical output (minus the new reactions field) to keep existing tests passing.
