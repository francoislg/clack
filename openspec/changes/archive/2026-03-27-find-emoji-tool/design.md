## Context

Clack provides Claude with MCP tools to interact with Slack workspace data. The `find_user` tool + `UsersCache` is the existing pattern for lazily fetching and caching Slack workspace data, then exposing it to Claude via search. The `emoji.list` Slack API returns all custom emojis in a single non-paginated call as a `Record<string, string>` (name → URL or `alias:other_name`).

## Goals / Non-Goals

**Goals:**
- Let Claude search custom workspace emojis by name
- Follow the established `find_user` / `UsersCache` pattern for consistency
- Add tool label mapping for Slack task card display

**Non-Goals:**
- Browsing/viewing actual emoji images (URL is returned, but no image rendering)
- Including built-in Unicode emojis (Claude already knows those)
- Admin-only gating (emojis are not sensitive)

## Decisions

### EmojiCache follows the UsersCache pattern with TTL
Lazy-loaded, in-memory cache with a 1-hour TTL. The `emoji.list` API is simpler than `users.list` — no pagination, no cursor. A single call returns the complete custom emoji map. Unlike `UsersCache` (which is fetch-once), the emoji cache expires after 1 hour because custom emojis change more frequently than workspace membership.

**Alternative considered:** Fetch-once like `UsersCache`. Rejected because emojis are added/removed more often and a stale cache would be confusing (user adds an emoji, asks Clack about it, gets "not found").

### Alias resolution in cache
The cache resolves aliases at fetch time. When an emoji entry is `"alias:other_name"`, the cache follows the chain and stores the final URL alongside the alias relationship. This means search results include `{ name, url, aliasFor? }` — Claude sees both the canonical URL and the alias context.

**Alternative considered:** Returning raw `alias:other_name` strings. Rejected because Claude would need to make a second lookup to resolve the URL, and the alias chain can be resolved trivially at cache time.

### Search matches the find_user style
Case-insensitive substring by default, `*` wildcard support. This keeps the developer experience consistent across Clack tools. The search matches against emoji names only (there's no other metadata to search against).

### Tool gated on slackClient presence only
Registered in `buildQueryTools` when `ctx.slackClient` is available, alongside `find_user`. No role gating — emoji names are not sensitive workspace data.

## Risks / Trade-offs

- **Large emoji lists**: Workspaces can have thousands of custom emojis. The full list is cached in memory. This is the same trade-off as `UsersCache` and is acceptable for the data size involved (a few hundred KB at most).
- **Scope requirement**: Requires adding `emoji:read` to the Slack app's bot token scopes and reinstalling. This is a one-time setup step documented in the README.
- **1-hour TTL staleness window**: Emojis added/removed within the TTL window won't be reflected until the cache expires. Acceptable trade-off — 1 hour is short enough to stay reasonably fresh without hammering the API.
