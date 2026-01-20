# Tasks: Add Slack User Context

## Implementation Tasks

### 1. Add Configuration Option
- [x] Add `fetchAndStoreUsername: boolean` to `SlackConfig` interface in `src/config.ts`
- [x] Default to `false` for privacy
- [x] Update `data/config.example.json` with `slack.fetchAndStoreUsername` at bottom

### 2. Create User Cache Module
- [x] Create `src/slack/userCache.ts`
- [x] Define `UserInfo` interface with `userId`, `username`, `displayName`
- [x] Implement in-memory `Map<string, UserInfo>` cache
- [x] Implement `getUserInfo(client, userId)` function that:
  - Returns cached value if present
  - Calls `users.info` API if not cached
  - Stores result in cache
  - Handles API errors gracefully
- [x] Implement `resolveUsers(client, userIds)` for batch resolution
- [x] Implement `formatUserIdentity(userId, userInfo)` for consistent formatting:
  - Format: `[DisplayName (@username - ID: USERID)]`
  - Fallback: `[DisplayName (ID: USERID)]` if no username
  - Fallback: `[@username (ID: USERID)]` if no display name
  - Fallback: `[ID: USERID]` if neither present
- [x] Implement `transformUserMentions(client, text)` to replace `<@USERID>` patterns

### 3. Extend Data Interfaces
- [x] Add `username?: string` to `ThreadMessage` in `src/sessions.ts`
- [x] Add `displayName?: string` to `ThreadMessage` in `src/sessions.ts`
- [x] Add `username?: string` to `SessionContext` in `src/sessions.ts`
- [x] Add `displayName?: string` to `SessionContext` in `src/sessions.ts`

### 4. Update Thread Context Fetching
- [x] Modify `fetchThreadContext()` in `src/slack/messagesApi.ts`
- [x] Accept `fetchUserNames` option parameter
- [x] Collect all user IDs from messages (including bot users)
- [x] Resolve usernames via user cache when enabled
- [x] Map resolved names back to messages
- [x] Transform `<@USERID>` mentions in message text

### 5. Update Claude Prompt Formatting
- [x] Modify `formatThreadContext()` in `src/claude.ts`
- [x] Use `formatUserIdentity()` from userCache for consistent formatting
- [x] Treat bot messages the same as user messages (no special case)

### 6. Update All Handlers
- [x] Update `src/slack/handlers/newQuery.ts` - transform message text when enabled
- [x] Update `src/slack/handlers/directMessage.ts` - transform message text when enabled
- [x] Update `src/slack/handlers/mention.ts` - transform message text when enabled
- [x] Update `src/slack/handlers/threadReply.ts` - transform message text when enabled
- [x] Update `src/slack/handlers/refine.ts` - transform message text when recreating session
- [x] Update `src/slack/handlers/update.ts` - transform message text when recreating session

## Verification
- [x] Config option `slack.fetchAndStoreUsername` works correctly
- [x] TypeScript compiles without errors
- [ ] Test with `fetchAndStoreUsername: false` - existing behavior unchanged
- [ ] Test with `fetchAndStoreUsername: true` - names appear in thread context
- [ ] Verify cache prevents duplicate API calls for same user

## Dependencies
- Tasks 1-3 can be done in parallel
- Task 4 depends on tasks 2 and 3
- Task 5 depends on tasks 2 and 4
- Task 6 depends on tasks 2 and 4
