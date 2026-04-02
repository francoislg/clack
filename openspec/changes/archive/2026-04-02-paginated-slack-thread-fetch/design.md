## Context

The `fetch_slack_message` tool has two disconnected code paths: a single-message fetch via `conversations.history` and a full-thread fetch via `fetchThreadContext` (hardcoded limit of 20). Claude must decide which path to use via `include_thread`, and often defaults to single-message, missing thread context. Long threads are silently truncated.

The shared `fetchThreadContext` function in `messagesApi.ts` handles user name resolution, mention transformation, and attachment extraction. It's also used by `core.ts` and `retry.ts` for loading conversation context.

## Goals / Non-Goals

**Goals:**
- Always return thread context when fetching a Slack message URL
- Support pagination so Claude can load more of long threads
- Keep a single code path through `fetchThreadContext`
- Preserve backward compatibility for other `fetchThreadContext` callers

**Non-Goals:**
- Changing `fetch_channel_messages` (separate tool, different use case)
- Cursor-based pagination (page/limit is simpler for Claude to use)
- Caching across calls (each invocation is a fresh Slack API call)

## Decisions

### Always fetch via `conversations.replies`

The single-message `conversations.history` path is removed. `conversations.replies` on a standalone message (no thread) returns just that message — same result, one code path. This eliminates the need for `include_thread` entirely.

**Alternative considered:** Keep `include_thread` but default to `true`. Rejected because there's no real use case for fetching a single message without its thread, and removing the parameter simplifies the tool interface.

### Page/limit pagination over cursor-based

Claude passes `page` (0-indexed) and `limit` (default 5). The tool fetches `(page + 1) * limit + 1` messages via `fetchThreadContext` and slices to the requested window. The +1 overfetch detects `has_more`.

**Alternative considered:** Slack cursor-based pagination. Rejected because cursors are opaque strings Claude would need to pass back — page/limit is more natural for an LLM tool interface.

### Default limit of 5

Small default gives Claude enough context (parent + a few replies) without flooding the response. Claude can always request more with a larger limit or next page.

### Maximum fetch cap of 200

Since page-based pagination re-fetches from the start, the total fetch grows linearly: `(page + 1) * limit + 1`. To avoid excessive Slack API calls (rate limits, timeouts), the tool rejects requests where the computed fetch exceeds 200 messages. This is generous for real-world threads — most Slack threads are under 50 messages.

### Add `limit` param to `fetchThreadContext`

Rather than duplicating the enrichment logic (user resolution, mention transformation, attachment extraction), the existing function gains an optional `limit` parameter defaulting to 20. Other callers (`core.ts`, `retry.ts`) are unaffected.

## Risks / Trade-offs

- **[Re-fetching on pagination]** Page 2 re-fetches page 1's messages from Slack to skip past them. For typical thread sizes (< 50 messages) this is negligible. → Acceptable trade-off for implementation simplicity.
- **[No total count from Slack API]** `conversations.replies` doesn't return a total message count. We can only report `has_more`, not "page 3 of 7". → Claude doesn't need exact totals; `has_more` is sufficient to decide whether to paginate.
- **[Message filtering in fetchThreadContext]** `fetchThreadContext` filters out malformed messages (missing text/user/ts) after fetching. This means the overfetch count may not exactly match the filtered output. In practice, Slack messages nearly always have these fields, so the filter drops ~0 messages. The pagination math assumes raw count ≈ filtered count. If the filter ever drops a message, the worst case is `has_more` being slightly inaccurate (off by one) — acceptable.
- **[Error swallowing in fetchThreadContext]** The function catches errors and returns `[]`. The tool treats empty results as "not found." This conflates "API error" with "message doesn't exist" — acceptable for now since both warrant the same user-facing error message.
