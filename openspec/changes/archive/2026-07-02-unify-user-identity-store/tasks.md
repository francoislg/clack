## 1. Registry record shape & schema

- [x] 1.1 Extend `UserRecord` (`src/userRegistry.ts`) with optional core fields `username?: string`, `avatarUrl?: string`, `otherNames?: string[]`.
- [x] 1.2 Extend `userRecordZod` with tolerant, per-field parsing for `username`, `avatarUrl` (`z.string().optional().catch(undefined)`) and `otherNames` (`z.array(z.string()).optional().catch(() => { log; return undefined })`) — no `.strict()`, graceful reader preserved.
- [x] 1.3 Add a unit test asserting a legacy record (no new fields) loads unchanged, and a record with malformed `otherNames`/`username`/`avatarUrl` logs + drops just that field without wiping the registry.

## 2. otherNames write-through mutator

- [x] 2.1 Add `mergeUserOtherNames(userId, { add?: string[]; remove?: string[] })` in `src/userRegistry.ts`, routed through `serialize()`, preserving all other core fields + plugin namespaces and creating a placeholder for unknown users.
- [x] 2.2 Implement normalization: trim, drop empties, case-insensitive dedup, preserve insertion order; case-insensitive removal; omit `otherNames` entirely when the resulting array is empty. Choose concrete bounds (e.g. ≤20 entries, ≤60 chars each).
- [x] 2.3 Unit-test add/remove/dedup/empty-omission/placeholder-creation and serialized concurrent writes (later write does not clobber with a stale base).

## 3. Full-roster sync primitive

- [x] 3.1 Add `syncRoster()` (in `src/userRegistry.ts` or a new `src/slack/rosterSync.ts`) that paginates `users.list`, filters non-deleted/non-bot/non-`USLACKBOT`, and upserts each member's Slack-sourced fields (`username`, `displayName`, `avatarUrl` via `image_original` → `image_512` → `""`) — preserving `github`, `otherNames`, `plugins`, and NOT bumping `lastFetched`.
- [x] 3.2 Add a persisted roster-sync marker in `data/state/` (e.g. `rosterSyncedAt`), distinct from per-record `lastFetched`, with a graceful zod reader; define the roster-sync TTL constant.
- [x] 3.3 Add coalescing so concurrent sync triggers collapse to one in-flight run (mirror `coalescedFetch`); skip gracefully when no Slack client is present.
- [x] 3.4 Unit-test: full upsert, exclusions, avatar resolution, pagination follow-through, human-field preservation, `lastFetched` untouched, coalescing, and no-client skip (mock the Slack client at the boundary).

## 4. find_user search over the registry

- [x] 4.1 Rework `createUsersCache`/`search` (`src/slack/usersCache.ts`) to scan `loadRegistry()` records instead of a cached `users.list` roster; fold `enrich()` into an up-front merge so the whole registry is the match universe.
- [x] 4.2 Widen `matchesUser` to test each term against `userId` (exact) + `username`, `displayName`, `github.username`, and every `otherNames` entry using `buildWildcardMatcher`; keep dedup-by-userId, pagination, `totalCount`, and `includePluginData` projection intact.
- [x] 4.3 Wire the TTL-gated lazy sync trigger into `search`: await `syncRoster()` on cold start (empty/absent marker); fire it in the background when stale-but-warm; skip when fresh.
- [x] 4.4 Include `otherNames` on result entries (`SlackUserEntry`) alongside `github`.
- [x] 4.5 Update `find_user` tool description (`src/tools/query/findUser.ts`) to note it searches username, display name, GitHub login, and alternate names (English — via-Claude path, no `t()`).
- [x] 4.6 Update/extend `findUser`/`usersCache` tests for registry-universe search, github + otherNames matching, non-roster users surfacing, and the sync-trigger cold/warm/fresh branches.

## 5. update_user otherNames operations

- [x] 5.1 Add `add_other_names?: string[]` and `remove_other_names?: string[]` to the `update_user` zod schema (`src/tools/actions/updateUser.ts`); inject `mergeUserOtherNames` via `UpdateUserDeps`.
- [x] 5.2 Treat other-names as anyone-writable (no permission gate, like `github`); keep the atomic all-or-nothing rejection when a co-submitted `display_name` is unauthorized; update the "nothing to update" guard to account for the new fields.
- [x] 5.3 Return the resulting `other_names` in the success payload; update the tool description to document the new args and their anyone-writable policy (English).
- [x] 5.4 Extend `updateUser.test.ts`: add/remove happy paths, dedup/normalization delegated to the mutator (mock it — assert the tool calls it with normalized intent, not the mutator's own behavior), anyone-writable authorization, atomic rejection with a co-submitted unauthorized `display_name`, and the nothing-to-update rejection when none of `display_name`/`github`/`add_other_names`/`remove_other_names` is provided.

## 6. Verification

- [x] 6.1 `npx tsc` clean; `npx oxlint` + `npx oxfmt --check` clean on all touched files.
- [x] 6.2 Full `npm test` passes.
- [x] 6.3 `openspec validate unify-user-identity-store --strict` passes.
- [x] 6.4 Run `graphify update .` to keep the knowledge graph current with the touched files.
