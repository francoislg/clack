## MODIFIED Requirements

### Requirement: UsersCache Abstraction

The system SHALL provide a `UsersCache` abstraction that fetches and caches the Slack workspace user list for search operations, enriches results from the persisted user registry, and reports the full match count for pagination.

#### Scenario: Cache created with factory function

- **WHEN** `createUsersCache(client, registryReader)` is called with a Slack `WebClient` and a registry reader
- **THEN** the system returns a `UsersCache` instance with a `search()` method
- **AND** the internal user list is initially empty (lazy-loaded on first search)

#### Scenario: First search triggers fetch

- **WHEN** `search()` is called for the first time on a `UsersCache` instance
- **THEN** the system fetches all workspace members via the Slack `users.list` API
- **AND** handles pagination to retrieve all members
- **AND** extracts userId, username, displayName, and avatarUrl for each non-deleted, non-bot member
- **AND** caches the result for subsequent calls

#### Scenario: Subsequent searches use cached data

- **WHEN** `search()` is called after the initial fetch
- **THEN** the system reuses the cached user list without making additional API calls

#### Scenario: Deleted and bot users excluded

- **WHEN** the system fetches the workspace user list
- **THEN** deleted users (`user.deleted === true`) are excluded from results
- **AND** bot users (`user.is_bot === true`) are excluded from results
- **AND** the Slack bot user (`USLACKBOT`) is excluded from results

#### Scenario: Avatar URL resolved from profile

- **WHEN** the system extracts a member's `avatarUrl`
- **THEN** it resolves to `profile.image_original` when present (custom-uploaded avatar)
- **AND** falls back to `profile.image_512` when `image_original` is absent
- **AND** uses the empty string when neither image field is present

#### Scenario: Search returns page and full match count

- **WHEN** `search(queries, { offset, limit, includePluginData })` is called
- **THEN** the system computes ALL matches across the cached roster, deduplicated by userId
- **AND** returns an object exposing the total number of matches AND the page slice `[offset, offset + limit)` of matching entries
- **AND** the full match count reflects every match, independent of `offset`/`limit`

#### Scenario: Roster is the search universe

- **WHEN** a userId exists in the registry (`data/state/users.json`) but is NOT present in the live Slack roster (e.g. a deactivated user)
- **THEN** that user does NOT appear in `search()` results
- **AND** the registry only enriches roster matches, never sources new results

#### Scenario: Malformed or absent registry data degrades gracefully

- **WHEN** a matched roster user has no registry record, or a record whose enrichment fields are malformed
- **THEN** `search()` still returns that user's base roster identity
- **AND** the registry read never throws — enrichment (`github`/`plugins`) is simply omitted for that user

### Requirement: find_user Query Tool

The system SHALL provide a `find_user` MCP query tool that searches Slack workspace members by userId, username, or display name, enriches each result with registry-held identity, and supports offset pagination with an accurate total count.

#### Scenario: Search by single term

- **WHEN** Claude calls `find_user` with `query: ["Nick"]`
- **THEN** the tool performs a case-insensitive substring match of `"nick"` against each user's username and displayName
- **AND** performs a case-insensitive exact match against each user's userId
- **AND** returns matching users as an array of entries, each at minimum `{ userId, username, displayName, avatarUrl }`

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

#### Scenario: Result enriched with registry github

- **WHEN** a matched user has a record in the user registry carrying a `github` object
- **THEN** the tool includes the full `github` object (not just `github.username`) on that user's result entry
- **AND** a matched user with no registry record, or a record without `github`, omits the field
- **AND** github enrichment is available to all roles

#### Scenario: Opt-in plugin data projection

- **WHEN** Claude calls `find_user` with `includePluginData: ["trivia"]`
- **AND** the caller's role is `dev` or higher
- **THEN** each result entry includes a `plugins` object populated from the registry record's `plugins.<name>` for each requested, present namespace
- **AND** a requested namespace that is absent for a user contributes nothing for that user (no error)

#### Scenario: Plugin data omitted by default

- **WHEN** `includePluginData` is omitted or empty
- **THEN** no result entry includes a `plugins` field
- **AND** the payload is identical to a call made before this capability existed (aside from `github` enrichment and the count fields)

#### Scenario: Plugin data denied below dev

- **WHEN** a caller whose role is below `dev` calls `find_user` with a non-empty `includePluginData`
- **THEN** the tool does NOT include any plugin data in the response
- **AND** the base identity result (including `github`) is still returned

#### Scenario: Offset pagination

- **WHEN** Claude calls `find_user` with `offset` (default 0) and `limit` (default 10)
- **THEN** the tool returns the page of matches in `[offset, offset + limit)`
- **AND** an `offset` beyond the last match returns an empty `users` array with the true `totalCount` still reported

#### Scenario: Offset and limit bounds

- **WHEN** `find_user` is called with a negative `offset`
- **THEN** the offset is clamped to 0
- **AND** a `limit` less than or equal to 0 falls back to the default of 10

#### Scenario: Tool response format

- **WHEN** `find_user` returns results
- **THEN** the response includes `users` (array), `totalCount` (the true number of matches across the whole roster, independent of `offset`/`limit`), `offset` (the echoed page offset), and `hasMore` (true when `offset + users.length < totalCount`)

#### Scenario: No matches found

- **WHEN** no users match any of the provided query terms
- **THEN** the tool returns an empty array with `totalCount: 0` and `hasMore: false`

#### Scenario: Avatar URL usable as image-tool source

- **WHEN** Claude has a user's `avatarUrl` from `find_user`
- **THEN** the tool description indicates the URL can be passed to an image tool (e.g. `generate_image`'s `input_image_url`) as a source/edit image

## ADDED Requirements

### Requirement: find_user is the instructed source of truth for user information

The system SHALL instruct Claude, via an always-loaded baseline instruction, to treat `find_user` as the canonical path for resolving teammate identity and to never fabricate user attributes.

#### Scenario: Baseline instruction ships for all roles

- **WHEN** the system assembles the system prompt for any role and trigger mode
- **THEN** a baseline `user/` instruction file is loaded that names `find_user` as the source of truth for user identity — display name, GitHub login, and profile
- **AND** it directs Claude to call `find_user` when it needs a user attribute not already in context
- **AND** it forbids guessing or fabricating a user's GitHub handle, name, or other attributes

#### Scenario: Instruction advertises pagination

- **WHEN** the baseline user-lookup instruction is loaded
- **THEN** it notes that `find_user` is paginated (`offset`) and reports `totalCount`, so Claude can page through to obtain the complete set when needed
