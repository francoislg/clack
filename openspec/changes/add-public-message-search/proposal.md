## Why

Clack can only read messages it is pointed at — `fetch_channel_messages` requires a known channel, so answering "where has `:bob:` been used?" or "has anyone discussed the retry bug?" is impossible without the user already knowing where to look. Slack's Real-time Search API (`assistant.search.context`) exposes workspace-wide keyword search to **bot** tokens via `search:read.public`, so this gap is closable without introducing a user token.

## What Changes

- New optional top-level config flag `allowPublicSearch: boolean` (defaults off), sibling to `allowScheduledMessages`.
- When enabled, the generated Slack manifest requests the `search:read.public` bot scope. **Enabling requires a workspace reinstall** — an existing bot token does not retroactively gain scopes.
- New query MCP tool `search_messages` (registered only when the flag is on) wrapping `assistant.search.context` with `disable_semantic_search: true` for literal keyword matching, restricted to `channel_types: public_channel`.
- The tool is only callable in sessions that carry an `action_token`. Slack emits one on `message.im` and `app_mention` (already-subscribed events); it is **absent** on `reaction_added` and on cron fires, so reaction-triggered and scheduled sessions cannot search.
- Search covers message **text** only. An emoji used as a *reaction* is not message content and remains outside this tool's reach — the shipped `lore_hint` path on `fetch_channel_messages` stays the evidence source for reaction usage.

## Capabilities

### New Capabilities
- `public-message-search`: the `allowPublicSearch` config flag, the `search_messages` tool contract (arguments, literal-matching guarantees, public-channel restriction, result shape with permalinks), `action_token` sourcing and its trigger-mode availability, role gating, and degradation when the scope is missing or no token is available.

### Modified Capabilities
- `manifest-generation`: `buildScopes` gains a conditional `search:read.public` scope driven by a new `publicSearch` entry in `ConfigFeatures`.

## Impact

- `data/config.json` — new optional `allowPublicSearch` key.
- `src/configSchemas.ts` — fail-fast zod entry, `.optional()`.
- `scripts/generate-manifest.ts` — `ConfigFeatures.publicSearch`, `getEnabledFeatures()`, `buildScopes()`. No `buildEvents()` change; the `BotScope` type's `| (string & {})` escape hatch means no type change.
- `src/tools/query/` — new `search_messages` tool; `src/tools/server.ts` gating; `src/tools/context.ts` to thread `action_token` into tool context.
- `src/slack/handlers/` — capture `action_token` off `message`/`app_mention` payloads.
- **Operational**: enabling the flag obligates the admin to re-upload the manifest *and* reinstall the app. Zero-config and flag-off deployments are byte-for-byte unaffected.
- Slack rate limits: ~10 req/min on small workspaces (400+/min on large), plus a user-level 10/min cap; pagination counts against both.
