# Proposal: Add Slack User Context

## Summary
Add Slack usernames and display names to thread context so Claude understands who is participating in conversations. This enables more natural responses that can reference users by name.

## Problem
Currently, thread context shows anonymous `[User]` labels for all participants. Claude has no way to:
- Distinguish between different users in a conversation
- Reference users by name in responses
- Understand the social context of who is asking questions

## Solution
1. Add a configurable `fetchUserNames` option (default: `false` for privacy)
2. When enabled, resolve Slack user IDs to usernames/display names via the `users.info` API
3. Cache user info in memory to minimize API calls
4. Store usernames in session context and thread messages
5. Format thread context with actual names instead of `[User]`

## Design Decisions
- **Config default is false**: Privacy-first approach; organizations must opt-in
- **In-memory cache only**: Usernames rarely change; no need for persistence or TTL
- **Both username and displayName stored**: Display name preferred, username as fallback
- **Backward compatible**: Existing sessions without usernames continue to work

## Scope
- New capability: `user-context` (username resolution and caching)
- Modified capability: `session-management` (add username fields to interfaces)

## Out of Scope
- User profile pictures or other metadata
- Caching to disk
- Batch preloading of workspace users
