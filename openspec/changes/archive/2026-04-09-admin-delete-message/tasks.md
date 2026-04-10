## 1. Tool Implementation

- [x] 1.1 Create `src/tools/admin/adminDeleteMessage.ts` with the `admin_delete_message` tool definition
- [x] 1.2 Parse the URL input using `parseSlackMessageUrl` from `fetchSlackMessage.ts`; return error if invalid
- [x] 1.3 Fetch the target message: use `conversations.replies` when `threadTs` is present, otherwise `conversations.history` with `oldest=ts, latest=ts, inclusive=true`
- [x] 1.4 Return "message not found (may be ephemeral)" error if no message is returned by the fetch
- [x] 1.5 Obtain Clack's bot ID via `auth.test()` and compare against `message.bot_id`; return "not posted by me" error if mismatch
- [x] 1.6 Call `chat.delete({ channel: channelId, ts: messageTs })`; handle `message_not_found` (already deleted) and `not_in_channel` errors with specific messages
- [x] 1.7 Write tests in `src/tools/admin/adminDeleteMessage.test.ts` covering: invalid URL, message not found, not Clack's message, already deleted, not in channel, successful top-level deletion, successful thread reply deletion

## 2. Tool Registration

- [x] 2.1 Import and register `createAdminDeleteMessageTool` in `src/tools/server.ts` inside the `canEditConfig` block, guarded by `ctx.slackClient` presence
