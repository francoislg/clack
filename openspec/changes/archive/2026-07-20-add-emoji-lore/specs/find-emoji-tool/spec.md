# find-emoji-tool Specification (delta)

## ADDED Requirements

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

## MODIFIED Requirements

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
