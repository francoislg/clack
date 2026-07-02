## Context

Identity today lives in two stores. The persisted registry (`src/userRegistry.ts` → `data/state/users.json`) is durable and human-authored (`github`, `plugins`) but **sparse** — a record exists only after the bot resolves that user (mention, per-user `users.info` via `src/slack/userCache.ts`). The ephemeral `UsersCache` (`src/slack/usersCache.ts`) fetches the whole `users.list` roster into process memory (never persisted, never invalidated) and is what `find_user` actually searches; the registry is left-joined onto the returned page only (`enrich()`), so `github` is returned but not searchable.

The registry is already "kinda the cache" — it just isn't complete, and it isn't the search source. This change makes it both.

Constraints that shape the design:
- The registry reader is **graceful/permissive** (state file): a shape mismatch logs + degrades to empty; never `.strict()`, never hard-narrow (CLAUDE.md). All new fields are optional.
- All registry writes funnel through the single serialized writer (`serialize()`), preserving concurrent-write safety.
- Tool descriptions and results stay English (via-Claude path); no `t()`.
- No migration: new fields are optional and the reader tolerates their absence.

## Goals / Non-Goals

**Goals:**
- Make `data/state/users.json` the single source of truth for `find_user`.
- Add `otherNames: string[]` and make it — plus `github.username` — part of the search haystack.
- Populate the registry with the FULL workspace roster via a periodic, TTL-gated `users.list` sync that preserves human-authored fields.
- Let anyone add/remove another user's `otherNames`.

**Non-Goals:**
- Changing how plugins read/write their namespaces (`sdk.users`), or the lazy per-user display-name refresh (`resolveUserIdentity`) — both stay as-is.
- Per-category alias weighting, fuzzy matching, or ranking. Matching stays substring/wildcard, unioned across terms.
- Surfacing the sync cadence as user config (a single internal TTL constant, like `DISPLAY_NAME_TTL_MS`).
- A Home Tab UI for editing aliases (tool-only for now).

## Decisions

### D1 — Registry becomes the search universe (enrich-first, then match)

`find_user`/`UsersCache.search` scans the loaded registry map (`loadRegistry()`) instead of the in-memory `users.list` roster. Each record is matched across `userId` (exact, case-insensitive) + `username`, `displayName`, `github.username`, and every `otherNames[]` entry (substring/wildcard via the existing `buildWildcardMatcher`). Pagination and `totalCount` semantics are unchanged; `includePluginData` projection still applies to the returned page.

*Alternative considered — keep roster as universe, add a second registry-only pass and union.* Rejected: two match paths, duplicate pagination logic, and it still can't drop the ephemeral roster. Enrich-first collapses to one scan over one store.

**BREAKING** vs the existing `find-user-tool` "Roster is the search universe" requirement: a user present in the registry but absent from the *current live* roster (e.g. recently deactivated, or synced then removed) now surfaces. This is the intended inversion — the registry, kept current by the sync, is authoritative.

### D2 — Full-roster sync populates the registry (Slack-sourced vs human-authored split)

A new `syncRoster()` primitive runs one paginated `users.list` pass and upserts every real (non-deleted, non-bot, non-`USLACKBOT`) member. It writes only **Slack-sourced** fields — `username`, `displayName`, `avatarUrl` — and never touches **human-authored** fields — `github`, `otherNames`, `plugins`. The record gains `username` and `avatarUrl` (needed because `find_user` matches on username and returns avatarUrl, both of which live only in the ephemeral roster today). This mirrors the existing preservation pattern in `upsertIdentity`/`mergeUserGithub` (read base, spread-preserve the untouched fields).

*Alternative — store the roster in a separate persisted file.* Rejected: reintroduces two stores. One record, split by provenance, is simpler and matches "users.json is the cache."

### D3 — Sync trigger: TTL-gated, lazily kicked by `find_user`

`find_user` checks a roster-sync marker; if stale (older than the sync TTL) it triggers `syncRoster()` and serves the current registry. **Cold start** (marker absent / registry empty of roster data) is the one case that *awaits* the sync so the first-ever search isn't empty; every subsequent stale trigger runs in the background (concurrent triggers coalesce to one, like `coalescedFetch`). No scheduler/boot timer.

*Alternatives:* boot + interval timer (more moving parts, fires when nobody's searching); reuse the PR monitor cadence (couples unrelated subsystems). TTL-on-demand mirrors the existing `DISPLAY_NAME_TTL_MS` pattern and only pays the cost when `find_user` is actually used.

### D4 — Sync marker separate from per-record `lastFetched`

Per-record `lastFetched` means "display-name freshness for the lazy refresh" — a different concern with a different TTL. The roster sync tracks its own `rosterSyncedAt` marker (in `data/state/`, e.g. alongside the registry). The full sync does NOT bump every record's `lastFetched` (that would suppress the legitimate lazy per-user refresh).

### D5 — `otherNames` write: add/remove ops, writable by anyone

`update_user` gains `add_other_names: string[]` and `remove_other_names: string[]`. Add/remove (not whole-array replace) is race-safe under the serialized writer and fits the incremental "Jo is Jonathan" flow without Claude read-modify-writing. A new serialized mutator `mergeUserOtherNames(userId, { add, remove })` normalizes (trim, drop empties, case-insensitive dedup) and preserves all other fields. Writable by ANY user, consistent with `github.username`; same atomic-rejection contract (unauthorized field ⇒ whole call rejected, nothing applied — though with only anyone-writable fields added, rejection only arises from a co-submitted `display_name`).

*Alternatives:* whole-array replace (`other_names: string[] | null`) — simpler signature but a lost-update race and forces read-modify-write; self/admin-only auth — blocks the third-party annotation that motivates the feature. Both revisable; the add/remove + anyone default matches the stated use case.

### D6 — `UsersCache` dissolves into registry + sync

The module's fetch-and-cache-roster job moves into `syncRoster()`; its `search()` becomes a registry scan. The `createUsersCache(client, registryReader)` seam is kept (tests stub it), but internally it reads the registry map and owns the lazy sync trigger. `enrich()` folds into the up-front merge.

## Risks / Trade-offs

- **[Cold-start latency]** First-ever `find_user` after a fresh boot awaits a full `users.list` pagination. → Bounded (same call `find_user` makes today on first search); only the first call pays it, and only until the marker is set.
- **[Stale roster surfaces gone/renamed users]** Between syncs the registry can lag Slack. → Short TTL keeps drift small; `resolveUserIdentity`'s per-user lazy refresh still corrects display names on the hot path; deactivated users appearing is acceptable (they were resolvable when synced).
- **[Registry growth]** Full roster means a record per workspace member, not just resolved ones. → `users.json` is a flat keyed map read once and cached in memory; workspace-sized, not a concern.
- **[Behavior change is observable]** `github.username` becoming searchable and non-roster users surfacing are real semantic shifts. → Captured explicitly in the modified `find-user-tool` spec; the instruction already frames `find_user` as source-of-truth, so Claude's usage is unaffected.
- **[Alias abuse]** Anyone can annotate anyone. → Same trust model as `github.username` today; wrong entries are removable by whoever notices. Normalization caps length/count to bound junk.

## Migration Plan

No data migration. All new record fields (`username`, `avatarUrl`, `otherNames`) are optional; the graceful reader loads legacy records unchanged and the first sync backfills `username`/`avatarUrl`. Rollback is code-only — reverting restores roster-as-universe; the extra persisted fields are inert to the old reader.

## Open Questions

- Sync TTL value (reuse `DISPLAY_NAME_TTL_MS` = 6h, or a distinct roster TTL?). Leaning a distinct constant since roster churn differs from name churn.
- `otherNames` normalization caps (max entries per user, max length per alias) — pick concrete bounds at implementation (e.g. 20 entries, 60 chars each).
- Whether add/remove vs whole-replace (D5) should be revisited if the user prefers the simpler signature.
