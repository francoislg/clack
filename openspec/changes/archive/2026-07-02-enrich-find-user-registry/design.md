## Context

`find_user` (`src/tools/query/findUser.ts`) delegates to `UsersCache.search()` (`src/slack/usersCache.ts`), which projects the Slack `users.list` roster into `{ userId, username, displayName, avatarUrl }` and slices to `limit`. It never touches the persisted registry (`src/userRegistry.ts` → `data/state/users.json`), which holds the durable `github` mapping and per-plugin namespaces. Two defects motivate the change beyond enrichment:

- `search()` slices before returning, so the true match count is lost; `findUser.ts` reports `total = results.length` (page size) and derives `truncated = total >= limit` — wrong at the boundary (exactly-`limit` matches falsely reads as truncated). Note the existing spec already *intended* `total` to be "matches before limit," so this also closes a spec/impl drift.
- There is no `offset`, so Claude cannot page past the first window.

Constraints: registry reads are graceful/permissive (a state file — never throw on shape drift). `find_user` is only registered when a Slack client is present (`server.ts`), and the tool context already carries `ctx.role` for gating. Tool output is Claude-facing (via-Claude path) and stays English.

## Goals / Non-Goals

**Goals:**
- Enrich each roster match with its registry `github` object (full object, always on when present).
- Opt-in, dev+-gated projection of named plugin namespaces via `includePluginData`.
- Real offset pagination and an accurate `totalCount`/`hasMore` contract.
- One baseline instruction making `find_user` the instructed source of truth for user info.

**Non-Goals:**
- Registry as a *search source*. The Slack roster stays the search universe; the registry only enriches matches (deactivated/registry-only users never surface).
- Any registry schema change or data migration.
- Slack scope changes.
- Exposing `lastFetched` or writing to the registry from `find_user` (it stays a read).

## Decisions

**1. Where the join happens — inside `UsersCache.search()`, via an injected registry reader.**
`createUsersCache(client, registryReader)` gains a second param. `search()` computes all matches, slices `[offset, offset+limit)`, then enriches only the page (not the whole match set) by `userId`. Enriching post-slice keeps the registry reads bounded to the returned page. The reader is the narrow surface `{ getUserRecord(userId) }` (already exported from `userRegistry.ts`), injected so tests stub it without touching disk. Alternative considered: enrich in `findUser.ts` after `search()` returns — rejected because `search()` owns the roster→entry projection and the page boundary, so the join belongs there; splitting it would leak the registry into the tool layer for no gain.

**2. Return shape of `search()` — `{ entries, totalMatched }`.**
Replaces the bare `SlackUserEntry[]`. `totalMatched` is computed before slicing. `findUser.ts` maps this to `{ users: entries, totalCount: totalMatched, offset, hasMore: offset + entries.length < totalMatched }`. The old `total`/`truncated` fields are **removed** (not aliased) — they were a page-size heuristic and keeping them invites confusion. This is a response-contract change to a Claude-facing tool, acceptable since no persisted data or external API depends on it.

**3. `includePluginData` gating — enforced in the tool, not the cache.**
`search()` receives the already-authorized `includePluginData` list; `findUser.ts` zeroes it out when `ctx.role` is below `dev` before calling `search()`. This keeps the cache role-agnostic and puts the permission decision at the same layer as every other tool gate. `github` carries no gate (it is a first-class identity field, no more sensitive than a display name, and already writable by anyone via `update_user`). Plugin namespaces can hold richer per-user state, so they match the dev+ bar of `find_sessions`/`find_changes`.

**4. Plugin data passthrough is opaque.**
Requested namespaces are copied from `record.plugins[name]` as-is (`JsonObject`), no per-plugin schema validation in `find_user` — the registry already validated on write, and this is a read returning to Claude. Absent namespace → omitted for that user, never an error (permissive).

**5. Instruction as a dedicated baseline file.**
New `data/default_configuration/user/user-lookup.md` rather than extending `slack-formatting.md` (which is about formatting/mentions). Baseline `user/` → loaded for every role and trigger. English, short. The tool *description* still carries the mechanics (offset/`includePluginData`/enrichment); the instruction carries the *routing policy* (source of truth, don't fabricate), because descriptions don't reliably create a must-route-here reflex.

## Risks / Trade-offs

- **Response-contract break for any caller keying on `total`/`truncated`.** → The only consumer is Claude via the tool result; updating the tool description + the `findUser.test.ts` assertions covers it. No persistence or external contract depends on these fields.
- **Registry reads per search page add I/O.** → Bounded to the returned page (≤ `limit`, default 10), and `getUserRecord` reads the in-memory cached registry map after first load — effectively free. Enriching post-slice (Decision 1) guarantees the bound.
- **`includePluginData` could leak plugin state to under-privileged callers.** → Gated at dev+ in the tool; below-dev callers get base identity only, plugin list silently dropped (documented in the spec scenario).
- **Instruction drift / over-calling.** → Claude might call `find_user` when the userId is already in context. Mitigated by wording ("when you need an attribute not already in context") and the fact that over-calling is cheap and safe.

## Migration Plan

No data migration. Ship code + the baseline instruction file together. Rollback is a straight revert — registry file untouched, no schema or Slack-scope change. Existing default-shape callers (no `includePluginData`, `offset` defaulting to 0) get the same users plus `github` enrichment and the corrected count fields.

## Open Questions

None blocking. Possible follow-up (out of scope): whether `find_user` should *also* surface a registry-only user as a distinct "known but not in workspace" result — deliberately excluded here to keep the roster as the single search universe.
