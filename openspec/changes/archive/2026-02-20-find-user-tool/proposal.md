## Why

Claude has no visibility into the Slack workspace's user directory. When a user asks "who owns this code?" or references someone by name, Claude cannot resolve names to Slack users. The existing `userCache.ts` only resolves known user IDs to names — there's no reverse lookup or search capability.

## What Changes

- Add a `find_user` query tool that searches Slack workspace members by userId, username, or display name
- Supports multiple search terms per call (union of results) for flexible matching
- Case-insensitive substring matching across all three searchable fields
- Introduce a `UsersCache` abstraction that fetches and caches the workspace user list, instantiated per session (with the abstraction designed for easy promotion to process-level caching later)

## Capabilities

### New Capabilities
- `find-user-tool`: MCP query tool for searching Slack workspace members by name, username, or user ID with multi-term substring matching and a session-scoped user list cache

### Modified Capabilities
- `clack-tools`: Register the new `find_user` tool in the query tool set — available to all roles (no gating needed, same visibility as Slack's member list)

## Impact

- **New files**: `src/tools/query/find_user.ts`, `src/slack/usersCache.ts`
- **Modified files**: `src/tools/server.ts` (register the new tool), `src/tools/types.ts` (add `client` to QueryToolContext if not already present)
- **Slack API**: Uses `users.list` (Tier 2, 20 req/min) — already covered by the existing `users:read` scope
- **Dependencies**: None — no new packages
