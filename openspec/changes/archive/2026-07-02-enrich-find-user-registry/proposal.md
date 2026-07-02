## Why

`find_user` today returns only the live Slack roster projection (`userId`, `username`, `displayName`, `avatarUrl`) and never reads the persisted `data/state/users.json` registry — so durable per-user attributes (the mapped GitHub identity, plugin data) are invisible to Claude, and there is no instruction telling Claude this tool is the canonical way to resolve people. The tool also cannot paginate (only a `limit`, no `offset`) and reports `total` as the returned page size rather than the true match count, so Claude cannot tell whether it has seen everyone.

## What Changes

- **Enrich results from the user registry.** Each `find_user` result is left-joined by `userId` against `data/state/users.json`; when a registry record exists, its full `github` object is included on the entry. The Slack roster remains the search universe — the registry only *enriches*, never *sources* (a registry-only / deactivated user does not appear in search).
- **Opt-in plugin data.** A new `includePluginData?: string[]` arg names plugin namespaces (e.g. `["trivia"]`) to project from `record.plugins.<name>` onto each entry. Default empty → zero plugin bytes and unchanged payloads. Requesting plugin data is **dev+ gated**; base identity + `github` stay available to all roles.
- **Real pagination + honest counts.** Add an `offset?` arg. `UsersCache.search()` returns the full match count alongside the page. `find_user` returns `totalCount` (true number of matches) and `hasMore`, fixing the current boundary bug where exactly-`limit` matches falsely reads as truncated.
- **Source-of-truth instruction.** Add a baseline `user/` instruction file establishing `find_user` as the canonical path for teammate identity (name, GitHub login, profile) and forbidding fabrication of user attributes.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `find-user-tool`: `UsersCache.search()` returns a full match count and accepts an offset; `find_user` gains registry enrichment (`github`), opt-in dev+-gated `includePluginData`, `offset` pagination, and a `totalCount`/`hasMore` response contract (replacing the page-size `total`/`truncated` fields). Adds a requirement that Claude is instructed to treat `find_user` as the source of truth for user information.

## Impact

- **Code:** `src/slack/usersCache.ts` (search return shape, offset, registry join), `src/tools/query/findUser.ts` (args, response envelope, role gating), `src/slack/userCache.ts`/`src/userRegistry.ts` (registry reader wired into cache construction), `src/tools/server.ts` (inject registry access; role context already present).
- **Instructions:** new `data/default_configuration/user/user-lookup.md` baseline file; extend `find_user` tool description with pagination + enrichment mechanics.
- **Tests:** `src/tools/query/findUser.test.ts` and `usersCache` tests updated for the new envelope (`totalCount`/`hasMore`), enrichment join, and `includePluginData` gating.
- **No data migration.** Registry schema is unchanged; this is a read-side join. No Slack scope changes.
