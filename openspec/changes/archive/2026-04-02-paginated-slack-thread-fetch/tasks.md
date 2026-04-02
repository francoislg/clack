## 1. fetchThreadContext limit parameter

- [x] 1.1 Add optional `limit` param to `FetchThreadContextOptions` interface in `src/slack/messagesApi.ts`
- [x] 1.2 Use `options.limit ?? 20` in the `conversations.replies` call
- [x] 1.3 Update `messagesApi.test.ts` to verify custom limit is passed through

## 2. Rewrite fetch_slack_message tool

- [x] 2.1 Replace `include_thread` param with `page` (default 0) and `limit` (default 5) in tool schema
- [x] 2.2 Remove the single-message code path (`conversations.history` branch)
- [x] 2.3 Implement pagination: call `fetchThreadContext` with `(page + 1) * limit + 1`, slice to page window, compute `has_more`
- [x] 2.4 Return `channel`, `thread_ts`, `message_count`, `page`, `limit`, `has_more` in response
- [x] 2.5 Register images/files from the returned page of messages

## 3. Tests

- [x] 3.1 Rewrite `fetchSlackMessage.test.ts` — test default pagination (5 messages)
- [x] 3.2 Test custom page/limit values
- [x] 3.3 Test `has_more` detection (thread longer than page)
- [x] 3.4 Test standalone message (no thread replies)
- [x] 3.5 Test thread reply URL (`?thread_ts=`) uses parent ts
- [x] 3.6 Test error cases (invalid URL, no Slack client, empty result)
- [x] 3.7 Test image/file registration from paginated results

## 4. Spec update

- [x] 4.1 Add `fetch_slack_message` requirement section to `openspec/specs/clack-tools/spec.md`
