## Context

Channel IDs flow through the entire system — from Slack events to sessions to prompts to tool results — but are never resolved to human-readable names. The `userCache.ts` module already demonstrates the caching pattern for Slack API lookups. Channel names change rarely, making them ideal for process-lifetime caching.

## Goals / Non-Goals

**Goals:**
- Resolve channel IDs to names via a cached `conversations.info` call
- Make channel name available in Claude's delivery context for all non-DM triggers
- Include channel name in pre-analysis classifier context
- Enrich MCP tool results that return channel IDs with the channel name

**Non-Goals:**
- Resolving channel topic or purpose (just name for now)
- Channel name in Home Tab display (future enhancement)
- Invalidating cache on channel rename (process-lifetime cache is sufficient)

## Decisions

### 1. New `channelCache.ts` module alongside `userCache.ts`

Mirror the `userCache.ts` pattern: in-memory `Map<string, ChannelInfo>`, `getChannelInfo(client, channelId)` calls `conversations.info` on cache miss, returns `{ id, name }`.

**Why not extend `userCache.ts`:** Channels and users are different entity types with different Slack API endpoints. Keeping them separate maintains single-responsibility and matches the existing codebase structure (`userCache.ts`, `usersCache.ts`).

### 2. Store `channelName` on the session

`SessionContext` gains an optional `channelName?: string` field. Resolved during `setupSession()` in `core.ts` using the cache. This makes the name available to the prompt builder and any downstream consumer with session access.

**Why on the session:** The session is the central data structure that flows through the pipeline. Resolving once at session creation avoids repeated lookups and keeps the prompt builder pure (no async API calls).

### 3. Include channel name in delivery context unconditionally (except DMs)

`buildDeliveryContext()` adds `"- Channel: #channel-name"` for all trigger types except `directMessages`. DMs have no meaningful channel name.

**Why unconditional:** The cost is one line in the prompt. The benefit — Claude knowing where it's talking — applies broadly across auto-respond, mentions, reactions, scheduled messages, and assistant panel contexts.

### 4. Pre-analysis resolves channel name independently

Pre-analysis runs before session creation, so it resolves the channel name directly via the cache and includes it in the classifier prompt. The cache means this is not a redundant API call — the session creation will hit the cache.

### 5. MCP tools include `channel_name` in results

`fetch_channel_messages` and `fetch_slack_message` already have `slackClient` access. They resolve the channel name via the cache and include it in their result objects alongside the existing channel ID.

## Risks / Trade-offs

**[Additional API calls]** → Each unique channel triggers one `conversations.info` call, cached for process lifetime. In practice, auto-respond monitors a small set of channels, so this is 3-5 API calls at startup, then zero.

**[Stale cache on channel rename]** → If a channel is renamed, the cache serves the old name until process restart. Acceptable tradeoff — channel renames are rare and the impact is cosmetic.

**[Session schema change]** → Adding `channelName` to `SessionContext` is additive and optional. No migration needed — existing persisted sessions simply won't have the field.
