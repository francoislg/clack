## Why

Clack has no durable user store. User identity lives in three half-solutions — an in-memory `userCache` (no TTL, lost on restart), a bulk `usersCache`, and per-plugin files like trivia's `data/plugins/trivia/users.json`. Every plugin that needs a display name re-implements its own caching and Slack-refresh logic. Centralizing user identity into one core-owned, persisted registry removes that duplication and gives plugins a tiny, invisible surface for user data.

## What Changes

- **New core user registry** persisted at `data/state/users.json`, keyed by `userId`, holding core identity fields (`userId`, `displayName`, `lastFetched`) plus a per-plugin namespace bag (`plugins.<name>`).
- **New SDK surface** exposed to plugins — exactly three concerns: `sdk.users.get(userId)`, `sdk.users.list()`, and `sdk.users.data(schema)` for reading/merging a plugin's own namespaced slice (zod-validated). Population, persistence, and freshness are fully invisible to plugins.
- **Invisible lazy refresh** — `get` returns cached identity; on a miss or when `now - lastFetched` exceeds a TTL it fetches from Slack, stamps `lastFetched`, and persists. `list` never fans out to Slack.
- **Core consolidation** — `userCache.getUserInfo` becomes the single write-through resolution primitive, persisting into the registry so core's own handlers warm it for free. Core code paths that need user data read through the registry instead of the ephemeral cache.
- **Remove trivia's `users.json`** — trivia reads/writes `joinedAt` and `cheatAttempts` through `sdk.users.data(schema)` against the `plugins.trivia` namespace; all ~21 trivia call sites swap to the SDK. **BREAKING** for trivia's on-disk format (handled by migration).
- **Blocking migration** folds existing `data/plugins/trivia/users.json` into `data/state/users.json` and deletes the old file.

## Capabilities

### New Capabilities
- `user-registry`: A core-owned, persisted, per-user store keyed by `userId` with core identity fields and per-plugin namespaces; the SDK `sdk.users` surface (`get`/`list`/`data(schema)`); TTL-gated invisible lazy display-name refresh; and write-through population from the core user-resolution path.

### Modified Capabilities
- `clack-plugins`: The plugin SDK contract gains the `sdk.users` accessor (`get`, `list`, `data(schema)`) as a new, supported capability plugins may depend on.

## Impact

- **New code:** core registry module (sibling of `src/userPreferences.ts`) with zod schema, cache, DI, serialized write-through; SDK `users` accessor wiring in `src/plugins/sdk.ts`.
- **Modified code:** `src/slack/userCache.ts` (write-through + `lastFetched` + TTL refresh); core consumers of `getUserInfo` that need persisted identity; `src/plugins/trivia/core/dataLayer.ts` (`loadUsers`/`saveUser`/`saveUsers`/`saveCheat`/`removeCheat` reroute) and the ~21 trivia call sites resolving display names; trivia `TriviaUser` type retires its core fields into the namespace slice.
- **Data:** new `data/state/users.json`; removal of `data/plugins/trivia/users.json` via blocking migration.
- **Specs:** new `user-registry`; delta to `clack-plugins`. Trivia behavior (joinedAt capture, cumulative `cheatAttempts`, reveal display names) is observably unchanged — storage relocation only.
- **Concurrency constraint:** all registry writes funnel through serialized SDK/core methods; plugins never touch the file directly.
