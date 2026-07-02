## Why

Clack keeps user identity in two disconnected stores: the persisted registry (`data/state/users.json`) — durable, human-authored (`github`, plugin data), but **sparse** (only users the bot has resolved) — and an ephemeral in-memory roster from `users.list` — **complete** but lost on restart and searchable-only. `find_user` searches the ephemeral roster and merely left-joins the registry onto the returned page, so registry-held identity (`github.username`, and any future alias) is **returned but not searchable**, and there is nowhere to record a nickname like "Jo is Jonathan" and have it found. Making `users.json` the single source of truth — the cache it already half is — lets one store be both durable and searchable.

## What Changes

- Add an OPTIONAL core `otherNames: string[]` field to the user record — a list of alternate names/nicknames ("Jo" → Jonathan) that feeds user search.
- **Invert the `find_user` search universe**: search the persisted registry (`users.json`) directly instead of the live in-memory `users.list` roster. **BREAKING** to the `find-user-tool` "Roster is the search universe" requirement (a userId absent from the live roster but present in the registry now surfaces).
- **Widen the search haystack**: match each query term against `userId` (exact) plus `username`, `displayName`, `github.username`, and every entry in `otherNames` (substring/wildcard). `github.username` becomes searchable for the first time.
- **Populate the registry from a periodic full-roster sync**: a `users.list` pass upserts every workspace member into `users.json` (adding `username` and `avatarUrl` as core Slack-sourced fields), TTL-gated and triggered lazily by `find_user`. The sync refreshes only Slack-sourced fields and NEVER clobbers human-authored fields (`github`, `otherNames`, `plugins`).
- Extend `update_user` with add/remove operations for `otherNames`, writable by anyone (consistent with `github.username`).
- Collapse the ephemeral `UsersCache` roster responsibility into the registry + sync; `find_user`'s search becomes an in-memory scan over the loaded registry map.

## Capabilities

### New Capabilities

- `user-roster-sync`: Periodic full-workspace `users.list` sync that upserts every member into the registry, adds `username`/`avatarUrl` as Slack-sourced core fields, is TTL-gated and lazily triggered, and preserves all human-authored fields.

### Modified Capabilities

- `user-registry`: Record gains OPTIONAL core `otherNames: string[]`, `username`, and `avatarUrl` fields; adds a serialized write-through mutator for `otherNames` (add/remove). (The full-roster upsert primitive that writes these fields is specified under the new `user-roster-sync` capability.)
- `find-user-tool`: Search universe becomes the persisted registry, not the live roster; the match haystack widens to include `github.username` and `otherNames`; the `UsersCache` fetch-and-cache behavior is replaced by a registry-backed scan plus lazy roster sync.
- `user-update-tool`: Gains `add_other_names` / `remove_other_names` write operations on the record, writable by any user, with the same atomic-rejection semantics as existing fields.

## Impact

- **Code**: `src/userRegistry.ts` (record shape, sync + otherNames mutators), `src/slack/usersCache.ts` (search reads registry, roster sync), `src/slack/userCache.ts` (Slack-sourced field mapping), `src/tools/query/findUser.ts`, `src/tools/actions/updateUser.ts`.
- **Behavior change**: `find_user` can now return users the bot has never interacted with (once synced) and users absent from the current live roster but present in the registry; `github.username` becomes a searchable term.
- **Data**: `data/state/users.json` records gain `username`, `avatarUrl`, `otherNames`; a roster-sync marker is tracked. No migration required — all new fields are optional and the reader is graceful.
- **Slack API**: `find_user` no longer fetches `users.list` on every cold start; instead a TTL-gated background sync refreshes the whole roster periodically.
