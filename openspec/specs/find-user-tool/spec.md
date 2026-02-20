# find-user-tool Specification

## Purpose
MCP query tool and supporting cache abstraction for searching Slack workspace members by name, username, or user ID with multi-term substring and wildcard matching.

## Requirements
### Requirement: UsersCache Abstraction

The system SHALL provide a `UsersCache` abstraction that fetches and caches the Slack workspace user list for search operations.

#### Scenario: Cache created with factory function

- **WHEN** `createUsersCache(client)` is called with a Slack `WebClient`
- **THEN** the system returns a `UsersCache` instance with a `search()` method
- **AND** the internal user list is initially empty (lazy-loaded on first search)

#### Scenario: First search triggers fetch

- **WHEN** `search()` is called for the first time on a `UsersCache` instance
- **THEN** the system fetches all workspace members via the Slack `users.list` API
- **AND** handles pagination to retrieve all members
- **AND** extracts userId, username, and displayName for each non-deleted, non-bot member
- **AND** caches the result for subsequent calls

#### Scenario: Subsequent searches use cached data

- **WHEN** `search()` is called after the initial fetch
- **THEN** the system reuses the cached user list without making additional API calls

#### Scenario: Deleted and bot users excluded

- **WHEN** the system fetches the workspace user list
- **THEN** deleted users (`user.deleted === true`) are excluded from results
- **AND** bot users (`user.is_bot === true`) are excluded from results
- **AND** the Slack bot user (`USLACKBOT`) is excluded from results

### Requirement: find_user Query Tool

The system SHALL provide a `find_user` MCP query tool that searches Slack workspace members by userId, username, or display name.

#### Scenario: Search by single term

- **WHEN** Claude calls `find_user` with `query: ["Nick"]`
- **THEN** the tool performs a case-insensitive substring match of `"nick"` against each user's username and displayName
- **AND** performs a case-insensitive exact match against each user's userId
- **AND** returns all matching users as an array of `{ userId, username, displayName }`

#### Scenario: Search by multiple terms

- **WHEN** Claude calls `find_user` with `query: ["Nick", "Nich", "Nicolas"]`
- **THEN** the tool matches each term independently against all users
- **AND** returns the union of all matches, deduplicated by userId

#### Scenario: Search with wildcard

- **WHEN** Claude calls `find_user` with a query term containing `*` (e.g., `"Mi*"`)
- **THEN** the tool treats `*` as a wildcard matching any characters
- **AND** performs a full-field wildcard match against username and displayName (e.g., `"Mi*"` matches "Mike", "Michael")
- **AND** does NOT apply wildcard matching to userId (userId is always exact match)

#### Scenario: Search matches across fields

- **WHEN** a search term matches a user's username but not their displayName
- **THEN** the user is included in results
- **AND** the same applies if the term matches displayName but not username
- **AND** userId is only matched exactly (case-insensitive), never by substring or wildcard

#### Scenario: Result limit

- **WHEN** Claude calls `find_user` with an optional `limit` parameter (default: 10)
- **THEN** the tool returns at most `limit` users
- **AND** indicates whether results were truncated

#### Scenario: No matches found

- **WHEN** no users match any of the provided query terms
- **THEN** the tool returns an empty array with `total: 0`

#### Scenario: Tool response format

- **WHEN** `find_user` returns results
- **THEN** the response includes `users` (array), `total` (number of matches before limit), and `truncated` (boolean)
