# find-emoji-tool Specification

## Purpose
EmojiCache abstraction and find_emoji query tool for searching custom Slack workspace emojis by name.
## Requirements
### Requirement: EmojiCache Abstraction

The system SHALL provide an `EmojiCache` abstraction that fetches and caches the Slack workspace custom emoji list for search operations.

#### Scenario: Cache created with factory function

- **WHEN** `createEmojiCache(client)` is called with a Slack `WebClient`
- **THEN** the system returns an `EmojiCache` instance with a `search()` method
- **AND** the internal emoji map is initially empty (lazy-loaded on first search)

#### Scenario: First search triggers fetch

- **WHEN** `search()` is called for the first time on an `EmojiCache` instance
- **THEN** the system fetches all custom emojis via the Slack `emoji.list` API (single call, no pagination)
- **AND** resolves alias entries (`alias:other_name`) to their final URL
- **AND** caches the result for subsequent calls

#### Scenario: Subsequent searches use cached data

- **WHEN** `search()` is called after the initial fetch
- **AND** the cache has not expired
- **THEN** the system reuses the cached emoji list without making additional API calls

#### Scenario: Cache expires after TTL

- **WHEN** `search()` is called more than 1 hour after the last fetch
- **THEN** the system discards the cached data and fetches a fresh emoji list from the Slack API
- **AND** resets the TTL timer

#### Scenario: Alias resolution

- **WHEN** the emoji list contains an alias entry (e.g., `"shipit": "alias:squirrel"`)
- **THEN** the cache resolves the alias to the target emoji's URL
- **AND** stores the alias relationship so it can be surfaced in search results

### Requirement: find_emoji Query Tool

The system SHALL provide a `find_emoji` MCP query tool that searches custom Slack workspace emojis by name AND by lore (meaning/tags from the emoji lore store).

#### Scenario: Search by single term

- **WHEN** Claude calls `find_emoji` with `query: "party"`
- **THEN** the tool performs a case-insensitive substring match against emoji names
- **AND** additionally matches the query against each lore entry's haystack (`name + meaning + tags`, case-insensitive substring)
- **AND** returns the merged results as an array of `{ name, url, aliasFor?, lore? }`

#### Scenario: Lore-matched results rank first and are deduped

- **GIVEN** lore exists for `crisis_cat` with tag "incident"
- **WHEN** Claude calls `find_emoji` with `query: "incident"`
- **THEN** `crisis_cat` appears in the results even though its name does not contain "incident"
- **AND** lore-matched entries are listed before name-only matches
- **AND** an emoji matched by both name and lore appears exactly once

#### Scenario: Lore attached to any result that has it

- **GIVEN** lore exists for `partyparrot`
- **WHEN** `partyparrot` is returned by a name match
- **THEN** the entry carries `lore: { meaning, tags, examples }`

#### Scenario: Lore for a deleted emoji is skipped

- **GIVEN** a lore entry whose name is absent from the `EmojiCache`
- **WHEN** a query matches that lore entry
- **THEN** the entry is not returned (the cache is the source of truth for postable emojis)
- **AND** the stored lore entry is left untouched

#### Scenario: lore_only listing

- **WHEN** Claude calls `find_emoji` with `query: "*"` and `lore_only: true`
- **THEN** the tool returns only lore-bearing emojis in compact form (name, meaning, tags — no examples, no urls)
- **AND** respects `limit` with the standard `total`/`truncated` fields

#### Scenario: lore_only still honors a narrowing query

- **GIVEN** lore exists for `crisis_cat` (tag "incident") and `partyparrot` (tag "celebration")
- **WHEN** Claude calls `find_emoji` with `query: "incident"` and `lore_only: true`
- **THEN** only `crisis_cat` is returned, in compact form

#### Scenario: lore_only default limit accommodates the full index

- **WHEN** Claude calls `find_emoji` with `lore_only: true` and no explicit `limit`
- **THEN** the default limit is 200 (not the 25 used for name searches), so a single call returns the whole index for typical workspaces
- **AND** `truncated` is `true` when the lore store exceeds that limit

#### Scenario: Empty lore store preserves legacy behavior

- **GIVEN** the emoji lore store is empty or missing
- **WHEN** Claude calls `find_emoji` with any query without `lore_only`
- **THEN** results are identical to name-only matching (`{ name, url, aliasFor? }`, no `lore` fields)

#### Scenario: Search with wildcard

- **WHEN** Claude calls `find_emoji` with a query containing `*` (e.g., `"party*"`)
- **THEN** the tool treats `*` as a wildcard matching any characters
- **AND** performs a full-name wildcard match (e.g., `"party*"` matches "partyparrot", "partytime")

#### Scenario: List all emojis

- **WHEN** Claude calls `find_emoji` with `query: "*"`
- **THEN** the tool returns all custom emojis in the workspace (subject to the limit parameter)

#### Scenario: Result limit

- **WHEN** Claude calls `find_emoji` with an optional `limit` parameter (default: 25)
- **THEN** the tool returns at most `limit` emojis
- **AND** indicates the total count and whether results were truncated

#### Scenario: No matches found

- **WHEN** no emojis match the provided query by name or lore
- **THEN** the tool returns an empty array with `total: 0`

#### Scenario: Tool response format

- **WHEN** `find_emoji` returns results
- **THEN** the response includes `emojis` (array of `{ name, url, aliasFor?, lore? }`), `total` (number of matches before limit), and `truncated` (boolean)

### Requirement: EmojiCache Membership Check

The `EmojiCache` interface SHALL expose `has(name: string): Promise<boolean>`, an exact-name membership check over the cached workspace emoji list (honoring the same lazy fetch and TTL as `search`). Callers needing to know whether a specific emoji exists SHALL use `has` rather than interpreting `search` results, since `search` is substring-based and would report a false positive for any name that is a substring of another.

#### Scenario: Exact membership hit

- **GIVEN** the workspace has a custom emoji named `party`
- **WHEN** `has("party")` is called
- **THEN** it returns `true`

#### Scenario: Substring is not membership

- **GIVEN** the workspace has `partyparrot` but no emoji named exactly `party`
- **WHEN** `has("party")` is called
- **THEN** it returns `false`

#### Scenario: Membership uses the cache

- **WHEN** `has` is called after `search` has already populated the cache within the TTL
- **THEN** no additional `emoji.list` API call is made

### Requirement: Lore Provenance in Full Results

When `find_emoji` attaches `lore` to a result (the non-`lore_only` path), the attached object SHALL carry `source` and `updatedAt` alongside `meaning`, `tags`, and `examples`. These make an entry auditable — they are what lets Claude tell a user that a meaning is an old inference rather than a stated fact, and they are the only way to surface either value, since both are stored but otherwise never returned.

The compact `lore_only` projection SHALL NOT carry them: it exists as a cheap whole-index read for emoji SELECTION, where provenance is irrelevant, and it is deliberately lean.

#### Scenario: Full results carry provenance

- **GIVEN** lore for `crisis_cat` with `source: "observed"` and `updatedAt: "2026-07-20T12:00:00.000Z"`
- **WHEN** Claude calls `find_emoji` with `query: "crisis"` (no `lore_only`)
- **THEN** the result's `lore` object contains `source: "observed"` and `updatedAt: "2026-07-20T12:00:00.000Z"`
- **AND** it still contains `meaning`, `tags`, and `examples`

#### Scenario: Compact projection stays lean

- **WHEN** Claude calls `find_emoji` with `lore_only: true`
- **THEN** each returned object has exactly the keys `name`, `meaning`, `tags`
- **AND** no `source` or `updatedAt` appears

#### Scenario: Emojis without lore are unchanged

- **GIVEN** the lore store is empty
- **WHEN** Claude calls `find_emoji` with any query without `lore_only`
- **THEN** results carry no `lore` key at all, exactly as before this change

### Requirement: Missing-Lore Curation Query

`find_emoji` SHALL accept an optional `missing_lore: boolean`. When `true`, it returns the names of workspace emoji that have NO lore entry — the worklist for filling the dictionary. Results SHALL honor `query` for narrowing (`"*"` matches all), and the payload's `emojis` field SHALL be a plain array of name strings rather than objects, since a name is the entirety of the useful information. It SHALL use the same larger default limit as `lore_only` (an index read, not a search) and report the standard `total`/`truncated` fields.

#### Scenario: Lists emoji lacking lore

- **GIVEN** the workspace has `crisis_cat`, `partyparrot`, and `team_approved`, and only `crisis_cat` has lore
- **WHEN** Claude calls `find_emoji` with `query: "*"` and `missing_lore: true`
- **THEN** `emojis` is `["partyparrot", "team_approved"]` (names only, no urls, no lore objects)
- **AND** `total` is 2

#### Scenario: Honors a narrowing query

- **GIVEN** the workspace has `partyparrot` and `partytime`, neither with lore, plus an unrelated unlored `crisis_cat`
- **WHEN** Claude calls `find_emoji` with `query: "party*"` and `missing_lore: true`
- **THEN** only `partyparrot` and `partytime` are returned

#### Scenario: Empty when every emoji is documented

- **GIVEN** every workspace emoji has a lore entry
- **WHEN** Claude calls `find_emoji` with `query: "*"` and `missing_lore: true`
- **THEN** `emojis` is empty and `total` is 0

#### Scenario: Everything is missing when the store is empty

- **GIVEN** the lore store is empty and the workspace has 4 custom emoji
- **WHEN** Claude calls `find_emoji` with `query: "*"` and `missing_lore: true`
- **THEN** all 4 names are returned

### Requirement: Oldest-First Lore Ordering

`find_emoji` SHALL accept an optional `sort: "oldest"`. When supplied together with `lore_only: true`, the compact index SHALL be ordered by `updatedAt` ascending (least-recently-updated first) before the limit is applied, so a single call surfaces the stalest entries. The compact projection SHALL NOT gain `updatedAt` as a result — ordering by a field does not require returning it, and the full (non-`lore_only`) lookup already carries the date when an exact value is needed.

#### Scenario: Stalest lore first

- **GIVEN** lore for `a` updated 2026-07-01, `b` updated 2026-05-01, and `c` updated 2026-06-01
- **WHEN** Claude calls `find_emoji` with `query: "*"`, `lore_only: true`, `sort: "oldest"`
- **THEN** the returned order is `b`, `c`, `a`

#### Scenario: Ordering applies before truncation

- **GIVEN** the three entries above
- **WHEN** the same call is made with `limit: 1`
- **THEN** only `b` is returned (the stalest), `total` is 3, and `truncated` is `true`

#### Scenario: Compact shape is unchanged by sorting

- **WHEN** a sorted `lore_only` call returns entries
- **THEN** each object still has exactly the keys `name`, `meaning`, `tags`

#### Scenario: Entries with no timestamp sort as stalest

- **GIVEN** a legacy entry whose `updatedAt` is `""` (the graceful schema's default) alongside dated entries
- **WHEN** Claude calls `find_emoji` with `lore_only: true`, `sort: "oldest"`
- **THEN** the undated entry comes first, since an entry with no recorded update is the one most in need of review

#### Scenario: Default ordering is preserved without sort

- **WHEN** Claude calls `find_emoji` with `lore_only: true` and no `sort`
- **THEN** the index order is unchanged from before this change

### Requirement: Curation Argument Conflicts Are Explicit

Illegal argument combinations SHALL return an error result naming the conflict, rather than silently resolving to one interpretation — a silently-ignored argument teaches Claude an incorrect contract.

#### Scenario: lore_only and missing_lore are mutually exclusive

- **WHEN** Claude calls `find_emoji` with both `lore_only: true` and `missing_lore: true`
- **THEN** the tool returns an error result explaining they are opposites
- **AND** no results are returned

#### Scenario: sort requires lore_only

- **WHEN** Claude calls `find_emoji` with `sort: "oldest"` but without `lore_only: true`
- **THEN** the tool returns an error result explaining that `sort` applies only to the `lore_only` index

