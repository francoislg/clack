## Context

Claude currently has no way to look up Slack workspace members. The existing `userCache.ts` resolves known user IDs to display names (ID → name), but there's no reverse lookup or search capability. When Claude needs to find someone (e.g., match a git author to a Slack user, or resolve a name the user mentions), it has no tool for this.

The Slack API has no server-side user search endpoint. `users.list` returns all members and filtering must happen client-side. `users.info` requires a known ID. `users.lookupByEmail` requires a known email.

The Slack `WebClient` is currently available in the handler layer (`src/slack/handlers/core.ts`) but is not threaded through to the tool layer. The `QueryToolContext` has no `client` field.

## Goals / Non-Goals

**Goals:**
- Allow Claude to search workspace members by name, username, or user ID
- Support multiple search terms per call for flexible matching (union of results)
- Cache the user list within a session to avoid repeated API calls
- Design the cache abstraction for easy promotion to process-level caching later

**Non-Goals:**
- Fuzzy/phonetic matching (substring matching is sufficient; Claude can generate variations)
- Searching by email, title, or other profile fields
- Process-level caching (Option C) — the abstraction supports it, but this change implements session-scoped only
- Exposing user search to worker mode tools

## Decisions

### 1. Thread `WebClient` via `QueryToolContext`

Add an optional `slackClient` field to `QueryToolContext`. The call chain becomes:

```
core.ts (has client)
  → askClaude(session, { slackClient: client })
    → buildQueryContext({ ..., slackClient })
      → buildQueryTools(ctx)  // ctx.slackClient available
        → createUsersCache(ctx.slackClient)
        → createFindUserTool(ctx, usersCache)
```

**Why optional**: The `verifyClaudeSetup` path in `claude.ts` builds a dummy context without a real Slack client. Making it optional avoids breaking that path. The `find_user` tool simply won't be registered when `slackClient` is absent.

**Alternatives considered**:
- Pass `UsersCache` as a separate parameter to `buildQueryTools` — adds a parameter to the function signature for a single tool's needs; threading through context is more consistent with the existing pattern.
- Create `UsersCache` at module level — would require the client at module init time, which isn't available.

### 2. `UsersCache` abstraction with session-scoped instantiation

Create `src/slack/usersCache.ts` with a factory function:

```typescript
interface UsersCache {
  search(queries: string[], limit?: number): Promise<SlackUserEntry[]>;
}

function createUsersCache(client: WebClient): UsersCache
```

The cache is a closure over a `SlackUserEntry[] | null`. First call fetches via `users.list` (paginated), subsequent calls reuse the cached array. The instance is created inside `buildQueryTools`, so it lives for exactly one Claude invocation and is garbage collected after.

**Why a separate file**: Keeps the cache logic testable in isolation and co-located with the existing `userCache.ts` (singular — individual lookups) in `src/slack/`.

**Why not extend `userCache.ts`**: Different concern — `userCache.ts` is a global ID→info cache used for mention formatting. `UsersCache` is a session-scoped searchable list. Merging them would muddy responsibilities.

### 3. Case-insensitive substring matching with deduplication

For each search term, check if it's a case-insensitive substring of any of the three searchable fields (userId, username, displayName). Results are the union across all terms, deduplicated by userId.

**Why not regex or glob**: Substring matching is predictable and safe — no injection risk from user-provided patterns. Claude is the caller, so it can construct multiple terms to cover variations.

### 4. No role gating

The tool returns userId, username, and displayName — information visible to every Slack workspace member in the sidebar. No role gating is needed, consistent with `list_repositories` which is also available to all roles.

### 5. Conditional tool registration

The tool is only registered when `ctx.slackClient` is present. This keeps the `verifyClaudeSetup` path working (which builds tools with a dummy context) and avoids runtime errors.

## Risks / Trade-offs

- **Large workspaces**: `users.list` for a 10,000-person workspace returns ~2MB of data and requires multiple paginated API calls. The first `find_user` call in a session will be slow (~1-3s). → Mitigated by caching within the session; subsequent calls are instant.

- **Rate limits**: `users.list` is Tier 2 (20 req/min). Since we cache per session, each session makes at most one `users.list` call (potentially multiple pages). Not a concern unless many concurrent sessions start simultaneously. → Acceptable for expected usage patterns.

- **Stale data within a session**: If someone joins/leaves the workspace mid-session, the cached list won't reflect it. → Sessions are typically short (minutes); staleness is negligible.
