# Tasks

## Implementation

- [x] Add `threadTs` field to `SessionContext` interface in `src/sessions.ts`
- [x] Update `createSession()` to accept `threadTs` parameter and persist it
- [x] Add `restoreSessionInfo()` function to load `SessionInfo` from disk
- [x] Add `parseSessionId()` function to extract channelId, messageTs, userId from sessionId
- [x] Update `restoreSessionInfo()` to reconstruct from parsed sessionId as fallback
- [x] Update `newQuery.ts` to pass `threadTs` when creating session
- [x] Update `accept.ts` to extract answer from message blocks for expired sessions
- [x] Update `reject.ts` - no changes needed (just deletes)
- [x] Update `refine.ts` to recreate expired sessions from Slack context
- [x] Update `update.ts` to recreate expired sessions from Slack context

## Verification

- [x] Verify TypeScript builds
- [ ] Test: Create session, restart app, click Accept → should post public message
- [ ] Test: Create session, let it expire, click Update → should recreate and regenerate
- [ ] Test: Create session, let it expire, click Refine → should recreate and regenerate
