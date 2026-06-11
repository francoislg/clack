## Context

User identity in Clack is fragmented across three half-solutions:

- `src/slack/userCache.ts` — an in-memory `Map<userId, UserInfo>`, no TTL, no persistence, lost on restart.
- `src/slack/usersCache.ts` — a bulk workspace list backing the `find_user` tool.
- `src/plugins/trivia/core/dataLayer.ts` — trivia's own `data/plugins/trivia/users.json` (`{userId, displayName, joinedAt, cheatAttempts?}`), with hand-rolled batch writes and a reveal-time Slack refresh (`refreshDisplayNames.ts`).

There is no durable, shared user store. Any plugin needing a display name must either reach for `sdk.getSlackClient()` and re-implement caching/refresh, or persist its own file — which is exactly what trivia did.

`src/userPreferences.ts` is the closest existing pattern and the template for this work: a `data/state/*.json` file keyed by `userId`, zod-validated, in-memory cached, DI'd, with per-key get/set. The new registry is its sibling — `userPreferences` holds user-*chosen* settings, the registry holds *observed identity* plus per-plugin data.

The agreed plugin surface is intentionally tiny — `get`, `list`, and `data(schema)`. Everything about how records get created, persisted, and kept fresh is core's problem and invisible to plugins. Core's own user-data paths consume the same registry rather than the ephemeral cache.

## Goals / Non-Goals

**Goals:**

- One core-owned persisted user store at `data/state/users.json`, keyed by `userId`.
- A three-method SDK surface (`sdk.users.get` / `.list` / `.data(schema)`) with population, persistence, and freshness fully hidden.
- Write-through population from the single core resolution primitive, so core handlers warm the registry for free.
- TTL-gated invisible lazy refresh of `displayName` on `get`.
- Remove trivia's `users.json`; trivia stores `joinedAt`/`cheatAttempts` in its namespace slice via `data(schema)`.
- Observably identical trivia behavior; a blocking migration carries existing data over.

**Non-Goals:**

- Replacing `usersCache`/`find_user` (the bulk search path stays as-is; it may *feed* the registry but is not subsumed).
- Cross-plugin reads of another plugin's namespace (`data(schema)` only ever exposes the caller's own slice).
- A user-management UI, opt-out, or GDPR-style deletion flow (future work).
- Real-time push updates of display-name changes (refresh stays lazy/TTL-driven).
- Merging `userPreferences` into the registry (kept as a separate concern).

## Decisions

### 1. One file, core-owned, plugins never touch it directly

`data/state/users.json` is written only by a single core module (sibling of `userPreferences.ts`). Plugins reach it exclusively through `sdk.users.*`. **Rationale:** a file written by core + N plugins is a read-modify-write race; trivia already needed atomic batch writes as the *sole* writer. Making the registry the only writer, with a serialized in-process write path, is the only way to keep concurrent writers safe. *Alternative considered:* let each plugin write its own namespace file — rejected, that's just the status quo re-spread and loses the shared identity benefit.

### 2. Record shape — core fields + nested `plugins.<name>` bag

```jsonc
{
  "U0382LJ3KPB": {
    "userId": "U0382LJ3KPB",
    "displayName": "François",
    "lastFetched": 1699123456789,
    "plugins": { "trivia": { "joinedAt": 1699..., "cheatAttempts": 2 } }
  }
}
```

`lastFetched` is core bookkeeping (epoch millis of the last successful Slack resolution) and is **not** surfaced in the plugin-facing user shape. **Rationale for nesting under `plugins`:** a future plugin keyed `userId`/`displayName` cannot shadow a core field; core validates its own fields strictly while the per-plugin bag stays permissive. *Alternative considered:* flat `trivia: {...}` on the record (the user's original sketch) — rejected for collision risk, negligible cost to nest.

### 3. Zod, two philosophies on one file (graceful reader)

Per the project's disk-validation convention, the registry is a **graceful** reader (persisted state): permissive schema, log-and-default on mismatch, never `.strict()`/`.datetime()` that could wipe real records. Core fields (`userId`, `displayName`, `lastFetched`) are modeled; `plugins` is `z.record(z.string(), z.unknown())` at the core layer. Each plugin's slice is validated by **its own** schema when it calls `data(schema)` — the SDK round-trips the namespace through the plugin-supplied zod schema on read and merge, so the plugin owns its shape (e.g. trivia's `{ joinedAt: z.number(), cheatAttempts: z.number().optional() }`).

### 4. Invisible lazy refresh via consolidating `getUserInfo`

`userCache.getUserInfo(client, userId)` becomes the single write-through resolution primitive: on resolve it persists `{userId, displayName, lastFetched: now}` into the registry and updates the in-memory cache. `sdk.users.get`:

```
get(userId):
  rec = store.get(userId)
  if rec exists AND (now - rec.lastFetched) <= TTL  → return rec (no Slack)
  else → getUserInfo(client, userId)  // fetch, stamp lastFetched, persist
         return updated rec (or cached rec if Slack fetch fails — never throw)
```

`list()` returns the cached store verbatim and **never** fans out to Slack — staleness is repaired per-`get`. A caller needing many fresh names at once (trivia's leaderboard) relies on the records already being warm, or on a bulk refresh routed through `usersCache`'s single `users.list` call rather than N `users.info` calls. **TTL** is a single constant (default a few hours), tunable later; not config-surfaced in v1. *Alternative considered:* eager refresh on every core interaction — rejected, button-only participants never pass through a message handler, so lazy-on-read is required regardless; eager-everywhere just adds Slack load.

### 5. SDK surface

```ts
interface ClackUser { userId: string; displayName: string; }        // no lastFetched
interface ClackSdkUsers {
  get(userId: string): Promise<ClackUser | null>;
  list(): Promise<ClackUser[]>;
  data<T>(schema: ZodType<T>): {
    get(userId: string): Promise<T | null>;
    merge(userId: string, partial: Partial<T>): Promise<void>;
  };
}
// sdk.users: ClackSdkUsers
```

`data(schema).merge` is field-merge into the caller's namespace (omit-to-keep), serialized through the core writer. The namespace key is the plugin name (auto-scoped, same as `readFile`/`writeFile`), so a plugin can never read or write another plugin's slice.

### 6. Core consumers read through the registry

Core paths that need persisted identity (e.g. handler display-name resolution that today feeds sessions) call `getUserInfo`, which now reads-through/writes-through the registry. No separate core-only accessor; the registry is the cache. This satisfies "the main paths should also use those."

## Risks / Trade-offs

- **Concurrent writers race on the JSON file** → single core writer with a serialized (queued/awaited) write path; plugins have no file handle, only `sdk.users.*`. Batch merges where possible.
- **`get` can block on a Slack call (cold/stale)** → matches today's `getUserInfo` latency; TTL keeps the hot path cache-only; Slack failure falls back to the stale cached record and never throws.
- **Migration mis-maps trivia fields and silently drops `joinedAt`/`cheatAttempts`** → blocking migration with explicit field mapping + a test fixture asserting a representative `users.json` round-trips into `plugins.trivia`; old file deleted only after successful write.
- **Too-strict registry schema wipes real records on first load** → graceful reader: permissive schema, log-and-return-default on parse failure, no `.strict()`/date coercion (per project convention).
- **`list()` returning stale names surprises a caller expecting freshness** → documented contract: `list` is cache-only; callers needing freshness use `get` (per-user) or the bulk-refresh path. Trivia's reveal continues to warm names before rendering.
- **Plugin passes a mismatched schema to `data(schema)`** → SDK round-trips through the plugin schema and returns `null`/logs on mismatch (graceful), never corrupts the stored bag.

## Migration Plan

1. Ship the registry module, SDK surface, and `getUserInfo` write-through behind no flag (additive; `data/state/users.json` is created on first write).
2. Blocking migration (`/create-migration`): read `data/plugins/trivia/users.json`; for each entry, upsert `{userId, displayName, lastFetched: 0}` and set `plugins.trivia = { joinedAt, cheatAttempts? }` (omit `cheatAttempts` when absent/0-equivalent per current semantics); write `data/state/users.json`; delete the trivia file.
3. Reroute trivia's `dataLayer` user functions and the ~21 call sites to `sdk.users.*`; retire the core fields from `TriviaUser` (namespace slice type only).
4. Point core display-name resolution paths at the consolidated `getUserInfo`.

**Rollback:** the migration is one-way (deletes the trivia file). Roll back by restoring `data/plugins/trivia/users.json` from backup and reverting code; the registry file is additive and harmless if left behind. `lastFetched: 0` on migrated records forces a one-time refresh on first `get`, which is the intended self-heal.

## Open Questions

- Exact TTL value (proposing a few hours; trivia previously refreshed ~daily at reveal). Constant in v1, config-surfaced only if a need appears.
- Whether the bulk-refresh helper (registry ← `usersCache.users.list`) ships in v1 or is deferred until a `list`-freshness need is concrete. Leaning defer; trivia's per-user warm path covers the current consumer.
