## Why

When a user DMs Clack referencing something Clack previously said in another context (e.g., a message posted to a public channel), Clack has no way to discover that prior context and responds as if it has no idea what the user is talking about. Giving Clack a tool to search its own recent session history lets it recover context on-demand instead of failing silently.

## What Changes

- New query tool `find_recent_interactions` that searches persisted Q&A session history
- Tool filters results by channel visibility (public channels) and the requesting user's own DMs — no cross-user DM leakage
- Keyword search matches across `originalQuestion`, `refinements`, and `lastAnswer` fields
- Supports `limit`, `offset`, and `type` (`all` | `dm` | `public_channels`) parameters
- System prompt instructions updated to direct Clack to call this tool when it lacks context for what the user is referring to

## Capabilities

### New Capabilities
- `find-recent-interactions`: Tool and associated session-scanning logic for querying Clack's own persisted Q&A session history

### Modified Capabilities
- `clack-tools`: New tool registered in the query tool set, available to all roles
- `delivery-context`: DM and mention prompt sections updated with guidance to call `find_recent_interactions` when context is unclear

## Impact

- `src/tools/query/findRecentInteractions.ts` — new tool implementation
- `src/tools/server.ts` — register the new tool in `buildQueryTools`
- `src/claude/promptBuilder.ts` — add instruction to DM and mention delivery context blocks
- `data/sessions/` — read-only scanning of existing session files (no schema change)
