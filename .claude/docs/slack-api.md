# Slack API: Messages and Reactions

This document covers the Slack API behavior relevant to fetching messages, particularly when dealing with reactions on thread messages.

## Key Concepts

### Message Timestamps (`ts`)

Every Slack message has a unique `ts` (timestamp) that serves as its ID. Format: `"1234567890.123456"` (seconds.microseconds).

- `ts` uniquely identifies a message within a channel
- Thread replies have their own `ts` plus a `thread_ts` pointing to the parent

### Thread Structure

```
Channel
├── Parent message (ts: "1234567890.000001")
│   ├── Reply 1 (ts: "1234567890.000002", thread_ts: "1234567890.000001")
│   ├── Reply 2 (ts: "1234567890.000003", thread_ts: "1234567890.000001")
│   └── Reply 3 (ts: "1234567890.000004", thread_ts: "1234567890.000001")
└── Another message (ts: "1234567890.000005")
```

## API Methods

### `conversations.history`

**Purpose:** Fetch messages from a channel's main conversation.

**Key behavior:**
- Returns **channel-level messages ONLY**
- **Thread replies are NOT included** - they exist only in `conversations.replies`
- Uses `latest` as upper bound, `oldest` as lower bound
- `inclusive: true` includes the message at exactly `latest` timestamp

```typescript
const result = await client.conversations.history({
  channel: channelId,
  latest: messageTs,  // Upper bound
  inclusive: true,    // Include message at exactly this ts
  limit: 1,
});
```

**Gotcha:** If you request a thread reply's timestamp, it will NOT be found. The API returns the closest channel message before that timestamp instead.

### `conversations.replies`

**Purpose:** Fetch messages from a specific thread.

**Key behavior:**
- `ts` parameter must be the **parent message's timestamp**
- Returns parent message + all replies in the thread
- Works for both threads with replies AND parent-only messages

```typescript
const result = await client.conversations.replies({
  channel: channelId,
  ts: parentTs,  // Must be the thread parent's ts
  limit: 100,
});
```

**Gotcha:** If you pass a reply's `ts` instead of the parent's `ts`, the API will fail or return unexpected results.

## `reaction_added` Event

When a user adds a reaction to a message, Slack sends:

```typescript
{
  type: "reaction_added",
  reaction: "emoji_name",  // Without colons
  user: "U12345",          // Who added the reaction
  item: {
    type: "message",
    channel: "C12345",
    ts: "1234567890.000002"  // Message that was reacted to
  },
  item_user: "U67890",     // Who created the message
  event_ts: "1234567890.000010"
}
```

**Critical limitation:** The `reaction_added` event does **NOT** include `thread_ts`, even if the message is a thread reply.

## The Problem: Fetching Thread Replies

When you receive a `reaction_added` event for a thread reply:

1. You get `event.item.ts` = the reply's timestamp
2. You don't know if it's a parent or reply (no `thread_ts` in event)
3. `conversations.history` won't find it (thread replies aren't in channel history)
4. You need `conversations.replies` but don't know the parent's `ts`

### Solution: Two-Step Approach

```typescript
const ts = event.item.ts;
let threadTs: string | undefined;
let messageText: string | undefined;

// Step 1: Try conversations.replies (works if ts is a parent)
try {
  const repliesResult = await client.conversations.replies({
    channel,
    ts: ts,
    inclusive: true,
    limit: 1,
  });

  if (repliesResult.messages?.[0]?.ts === ts) {
    // Found it - ts is a parent message
    threadTs = repliesResult.messages[0].thread_ts || ts;
    messageText = repliesResult.messages[0].text;
  }
} catch {
  // ts is not a parent, continue to Step 2
}

// Step 2: If not found, try conversations.history
if (!messageText) {
  const histResult = await client.conversations.history({
    channel,
    latest: ts,
    inclusive: true,
    limit: 1,
  });

  const msg = histResult.messages?.[0];
  if (msg) {
    if (msg.ts === ts) {
      // Found exact match - channel-level message
      threadTs = msg.thread_ts;
      messageText = msg.text;
    } else if (msg.thread_ts) {
      // Got a different message - our target might be a thread reply
      // Use the returned message's thread_ts to search the thread
      threadTs = msg.thread_ts;

      const threadResult = await client.conversations.replies({
        channel,
        ts: threadTs,
        limit: 100,
      });

      const targetMsg = threadResult.messages?.find(m => m.ts === ts);
      if (targetMsg) {
        messageText = targetMsg.text;
      }
    }
  }
}
```

## Best Practices

1. **Always verify `msg.ts === ts`** when using `conversations.history` - don't assume you got the right message
2. **Prefer `conversations.replies`** when you know you're dealing with threads
3. **Handle both cases** (parent and reply) since `reaction_added` doesn't tell you which
4. **Cache the message text** once fetched to avoid redundant API calls
5. **Log API results** during development to understand what Slack returns

## References

- [Slack Events API: reaction_added](https://api.slack.com/events/reaction_added)
- [conversations.history](https://api.slack.com/methods/conversations.history)
- [conversations.replies](https://api.slack.com/methods/conversations.replies)
- [GitHub Issue: reactions on threaded replies don't have thread_ts](https://github.com/slackapi/bolt-js/issues/1341)
