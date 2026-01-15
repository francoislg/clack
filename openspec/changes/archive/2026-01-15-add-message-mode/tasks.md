# Tasks

## Implementation

- [x] Add `directMessages.enabled` to config schema in `src/config.ts`
- [x] Create `src/slack/handlers/directMessage.ts` for handling DMs and @mentions
- [x] Add message event listener for `app_mention` events
- [x] Add message event listener for `message` events in DMs (im type)
- [x] Implement "Investigating..." message posting and updating
- [x] Create session for new top-level messages
- [x] Create `src/slack/handlers/threadReply.ts` for auto-responding to thread messages
- [x] Add message event listener for messages in threads where bot is participant
- [x] Continue existing session for thread replies
- [x] Register new handlers in `src/slack/app.ts` (only when `directMessages.enabled`)

## Verification

- [x] Verify TypeScript builds
- [x] Test: DM the bot → should respond with visible message
- [x] Test: @mention bot in channel → should respond in thread
- [x] Test: Reply in thread → bot should auto-respond
