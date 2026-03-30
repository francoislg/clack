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

The system SHALL provide a `find_emoji` MCP query tool that searches custom Slack workspace emojis by name.

#### Scenario: Search by single term

- **WHEN** Claude calls `find_emoji` with `query: "party"`
- **THEN** the tool performs a case-insensitive substring match against emoji names
- **AND** returns all matching emojis as an array of `{ name, url, aliasFor? }`

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

- **WHEN** no emojis match the provided query
- **THEN** the tool returns an empty array with `total: 0`

#### Scenario: Tool response format

- **WHEN** `find_emoji` returns results
- **THEN** the response includes `emojis` (array of `{ name, url, aliasFor? }`), `total` (number of matches before limit), and `truncated` (boolean)
