## Why

The `fetch_slack_message` tool currently has two separate code paths: fetch a single message (no thread context), or fetch the entire thread (up to 20 messages, no pagination). When users share a Slack URL, Claude must guess whether to pass `include_thread: true` — and if it doesn't, it misses the conversation context. Threads longer than 20 messages are silently truncated with no way to load more.

## What Changes

- **Remove `include_thread` parameter** — the tool always fetches thread context via `conversations.replies`
- **Add `page` / `limit` pagination** — default `page: 0`, `limit: 5` returns the first 5 messages; Claude can request more with `page: 1, limit: 20`, etc.
- **Return `has_more` flag** — so Claude knows whether additional pages are available
- **Remove the single-message code path** — `conversations.replies` on a standalone message returns just that message, so no separate path is needed
- **Add `limit` parameter to `fetchThreadContext`** — defaults to 20 (existing callers unaffected), allows the tool to control fetch size for pagination

## Capabilities

### New Capabilities

_(none — this is a redesign of an existing tool)_

### Modified Capabilities

- `clack-tools`: Adding a spec entry for `fetch_slack_message` (currently unspecified) with the new paginated behavior

## Impact

- `src/tools/query/fetchSlackMessage.ts` — rewritten: new params, single code path
- `src/slack/messagesApi.ts` — `fetchThreadContext` gains optional `limit` param
- `src/tools/query/fetchSlackMessage.test.ts` — tests rewritten for new API
- `openspec/specs/clack-tools/spec.md` — new requirement section for `fetch_slack_message`
- No impact on `fetch_channel_messages` (separate tool, unchanged)
- No impact on other `fetchThreadContext` callers (`core.ts`, `retry.ts`) — they use the default limit
