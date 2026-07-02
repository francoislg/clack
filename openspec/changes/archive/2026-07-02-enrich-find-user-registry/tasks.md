## 1. UsersCache: count, offset, registry enrichment

- [x] 1.1 Add a narrow registry-reader type (`{ getUserRecord }`) and change `createUsersCache(client, registryReader)` to accept and store it (`src/slack/usersCache.ts`)
- [x] 1.2 Extend `SlackUserEntry` with optional `github?: { username: string }` and `plugins?: { [name]: JsonObject }`
- [x] 1.3 Change `search()` signature to `search(queries, { offset?, limit?, includePluginData? })` returning `{ entries, totalMatched }`; compute all matches (dedup by userId), set `totalMatched` before slicing, then slice `[offset, offset+limit)`
- [x] 1.4 Enrich only the sliced page: for each entry, `getUserRecord(userId)` → attach full `github` when present; when `includePluginData` is non-empty, attach `plugins[name]` for each requested, present namespace (opaque passthrough, omit absent)
- [x] 1.5 Keep the roster as the search universe — never source entries from the registry (deactivated/registry-only users must not appear)

## 2. find_user tool: args, gating, response envelope

- [x] 2.1 Add `offset?` and `includePluginData?: string[]` to the `find_user` zod schema (`src/tools/query/findUser.ts`)
- [x] 2.2 Gate plugin data: zero out `includePluginData` before calling `search()` when `ctx.role` is below `dev` (base identity + `github` still returned)
- [x] 2.3 Map `search()` result to the new envelope: `{ users, totalCount, offset, hasMore: offset + users.length < totalCount }`; remove the old page-size `total`/`truncated` fields
- [x] 2.4 Wire the registry reader into `createUsersCache(...)` — via the `defaultUserRegistryReader` default param (matching the `defaultUpdateUserDeps` convention), so the `src/tools/server.ts` call site stays `createUsersCache(ctx.slackClient)`
- [x] 2.5 Update the `find_user` tool description: registry `github` enrichment, `offset` pagination + `totalCount`/`hasMore`, and `includePluginData` (dev+) — English, via-Claude path

## 3. Source-of-truth instruction

- [x] 3.1 Create baseline `data/default_configuration/user/user-lookup.md`: name `find_user` as the source of truth for user identity (name, GitHub login, profile), direct Claude to call it for any user attribute not already in context, forbid fabrication, and note `offset`/`totalCount` pagination — short, English

## 4. Tests

- [x] 4.1 Update `src/tools/query/findUser.test.ts`: replace `total`/`truncated` assertions with `totalCount`/`offset`/`hasMore`; add offset-paging (incl. negative-offset clamp and `limit <= 0` → default 10), `github` enrichment, `includePluginData` projection, and dev-gating (below-dev drops plugin data) cases; mock the registry reader
- [x] 4.2 Update/extend `UsersCache` tests in `src/slack/usersCache.test.ts`: `totalMatched` independent of `offset`/`limit`, slice correctness, registry-only user excluded from results, enrichment join by userId, and graceful degradation when a matched user has no/malformed registry record
- [x] 4.3 Run `npx tsc`, `npx oxlint` on touched files, and `npm test`; fix any fallout

## 5. Verify

- [x] 5.1 Validate the change: `openspec validate enrich-find-user-registry --strict`
- [x] 5.2 Confirm default-shape calls (no `includePluginData`, `offset` 0) return the same members plus `github` and the corrected count fields (no behavioral regression)
