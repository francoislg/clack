## 1. Core registry module

- [x] 1.1 Create `src/userRegistry.ts` (sibling of `src/userPreferences.ts`): zod schema for `Record<userId, { userId, displayName, lastFetched, plugins?: Record<string, unknown> }>` as a **graceful** reader (permissive, log-and-default on mismatch, no `.strict()`/date coercion), with in-memory cache, DI deps (`readFile`/`writeFile`/`mkdir`/`fileExists`), and `getStateDir()`/path helpers pointing at `data/state/users.json`
- [x] 1.2 Implement a single serialized write path (in-process queue/await chain) so concurrent upserts/merges cannot lose updates; expose `upsert(userId, {displayName, lastFetched})`, `get(userId)`, `list()`, `mergeNamespace(plugin, userId, partial)`, `getNamespace(plugin, userId)` internal functions
- [x] 1.3 Add `clearRegistryCache()` + DI reset/set exports for tests (mirror `userPreferences.ts`)
- [x] 1.4 Unit tests: persistence round-trip, malformed-file graceful default, namespace isolation (core fields not shadowed), serialized concurrent merges both persist

## 2. Consolidate userCache into write-through resolution

- [x] 2.1 Update `src/slack/userCache.ts` so `getUserInfo` write-through-persists `{userId, displayName, lastFetched: now}` into the registry on every successful Slack resolution, and keeps its in-memory cache
- [x] 2.2 Add TTL-gated lazy refresh: a `resolveUser(client, userId)` path that returns the cached/persisted record when `now - lastFetched <= TTL`, else refreshes via Slack, stamps `lastFetched`, persists; on Slack failure return the stale cached record without throwing; when the Slack client is unavailable (`null`), return the cached/fallback record without attempting a fetch. Coalesce concurrent stale-refreshes for the same `userId` via an in-flight promise map so simultaneous `get`s trigger at most one Slack call
- [x] 2.3 Define the TTL as a single module constant (default a few hours); document it inline
- [x] 2.4 Point core consumers that need persisted identity (handler display-name resolution feeding sessions) at the consolidated path; verify `find_user`/`usersCache` are left intact
- [x] 2.5 Unit tests: fresh→cache-only (no Slack call), stale→refresh+persist, stale-refresh-failure→cached fallback, restart→record survives

## 3. SDK users surface

- [x] 3.1 Add `ClackUser` (`{userId, displayName}` — no `lastFetched`) and `ClackSdkUsers` (`get`/`list`/`data(schema)`) types to `src/plugins/sdk.ts`
- [x] 3.2 Implement `sdk.users.get`/`list` delegating to the registry (identity only; strip `lastFetched` and `plugins`), and `data(schema)` auto-scoped to the calling plugin name with `.get` (zod-parse, `null` on absence/mismatch) and `.merge` (field-merge through the serialized writer)
- [x] 3.3 Wire `sdk.users` into the SDK factory; ensure the Slack client handle is resolved lazily (registry refresh works once Slack is connected)
- [x] 3.4 Unit tests: `get`/`list` shape, `data(schema)` reads/merges only the caller's namespace, mismatched schema returns `null` without throwing, cross-plugin isolation

## 4. Blocking migration

- [x] 4.1 Use `/create-migration` to scaffold a blocking migration that folds `data/plugins/trivia/users.json` into `data/state/users.json`: per entry upsert `{userId, displayName, lastFetched: 0}` and set `plugins.trivia = { joinedAt, cheatAttempts? }` — copy `cheatAttempts` only when present and `> 0` (a `0`/absent counter reads identically), always carry `joinedAt` — then delete the trivia file. Merge into any existing registry record rather than overwriting (registry may already be populated from boot)
- [x] 4.2 Migration test fixture: a representative `users.json` round-trips into the registry with `plugins.trivia` populated and the old file removed; `lastFetched: 0` forces one-time refresh on next `get`

## 5. Trivia migration to the SDK surface

- [x] 5.1 Define trivia's namespace zod schema `{ joinedAt: z.number(), cheatAttempts: z.number().optional() }` and a thin accessor over `sdk.users.data(schema)`; retire `userId`/`displayName` from `TriviaUser` (namespace-slice type only)
- [x] 5.2 Reroute `dataLayer.ts` `loadUsers`/`saveUser`/`saveUsers` to read identity via `sdk.users` and namespace via `data(schema)`; delete the `users.json` read/write helpers
- [x] 5.3 Reroute `saveCheat`/`removeCheat` to merge `cheatAttempts` through `data(schema).merge`; preserve cumulative-never-reset semantics
- [x] 5.4 Update join-on-first-answer sites (`answerTypes/clickHandlerInstaller.ts`, `answerTypes/freeform.ts`) to set `joinedAt` only-if-absent — read the namespace, skip the merge when `joinedAt` already present (preserve original join time), else `merge({ joinedAt: now })`. Identity (`displayName`) is no longer written here — it comes from the registry's write-through resolution
- [x] 5.5 Update display-name read sites to `sdk.users.get(...)`/`list()` (all 11 confirmed to read identity today): `tools/reveal/computeAnswers.ts`, `tools/reveal/updateAnswersBlock.ts`, `freeform/roster.ts`, `tools/answers/retrieveScores.ts`, `domain/computeLeaderboard.ts`, `answerTypes/reactorBuckets.ts`, `answerTypes/boolean.ts`, `answerTypes/choice.ts`, `answerTypes/freeform.ts`, `tools/questions/getQuestionHistory.ts`, `tools/lock/applyLock.ts` (all relative to `src/plugins/trivia/`)
- [x] 5.6 Replace `refreshDisplayNames.ts` reveal-time refresh with reliance on `sdk.users.get` lazy refresh (or a documented bulk-warm), removing trivia's bespoke Slack refresh

## 6. Specs, tests, verification

- [x] 6.1 Update affected trivia unit tests to mock the SDK `users` surface instead of the `users.json` data layer (per repo unit-test-mocks-dependencies rule)
- [x] 6.2 `npx tsc` clean; `npx oxlint`/`npx oxfmt --check` clean on all touched files
- [x] 6.3 Full `npm test` green; manually verify a trivia round (join → answer → reveal leaderboard) renders display names correctly against the registry
- [x] 6.4 `graphify update .` to keep the graph in sync with moved code
