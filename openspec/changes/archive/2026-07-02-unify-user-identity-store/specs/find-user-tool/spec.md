## MODIFIED Requirements

### Requirement: UsersCache Abstraction

The system SHALL provide a `UsersCache` abstraction whose search operates over the persisted user registry (`data/state/users.json`) as the source of truth, kept current by the full-roster sync, and reports the full match count for pagination. The abstraction SHALL NOT search a separate in-memory `users.list` roster; the live Slack roster reaches search only by having been synced into the registry.

#### Scenario: Cache created with factory function

- **WHEN** `createUsersCache(client, registryReader)` is called with a Slack `WebClient` and a registry reader
- **THEN** the system returns a `UsersCache` instance with a `search()` method
- **AND** search reads from the registry map rather than a separately cached roster

#### Scenario: Search reads the registry map

- **WHEN** `search()` is called
- **THEN** the system loads the registry map (from cache when warm) and computes matches over its records
- **AND** does not fetch `users.list` inline for the match computation (roster freshness is handled by the lazy sync trigger)

#### Scenario: Registry is the search universe

- **WHEN** a userId exists in the registry (`data/state/users.json`)
- **THEN** that user is eligible to appear in `search()` results even if absent from the current live Slack roster
- **AND** a userId that has never been synced or resolved into the registry is not searchable until it is

#### Scenario: Search returns page and full match count

- **WHEN** `search(queries, { offset, limit, includePluginData })` is called
- **THEN** the system computes ALL matches across the registry, deduplicated by userId
- **AND** returns an object exposing the total number of matches AND the page slice `[offset, offset + limit)` of matching entries
- **AND** the full match count reflects every match, independent of `offset`/`limit`

#### Scenario: Malformed or absent enrichment degrades gracefully

- **WHEN** a matched registry record has malformed optional fields (e.g. `github` or a requested plugin namespace)
- **THEN** `search()` still returns that user's base identity (`userId`, `username`, `displayName`, `avatarUrl`)
- **AND** the malformed field is simply omitted for that user rather than throwing

#### Scenario: Record missing synced base fields returns empty strings

- **WHEN** a matched registry record has no `username` and/or no `avatarUrl` (e.g. a placeholder created by `update_user` before any roster sync touched it)
- **THEN** the record is still eligible to match and appear in results
- **AND** the absent `username`/`avatarUrl` fields are returned as the empty string rather than omitted or null

### Requirement: find_user Query Tool

The system SHALL provide a `find_user` MCP query tool that searches the user registry by userId, username, display name, mapped GitHub login, and human-authored alternate names (`otherNames`), and supports offset pagination with an accurate total count. Each result entry SHALL carry at minimum `{ userId, username, displayName, avatarUrl }` plus registry-held identity (`github`, `otherNames`) when present. A Slack-sourced base field that is absent on the record (e.g. `username` or `avatarUrl` on a record not yet touched by a roster sync — such as a placeholder created by `update_user`) SHALL be returned as the empty string, so the entry shape is stable regardless of sync state.

#### Scenario: Search by single term

- **WHEN** Claude calls `find_user` with `query: ["Nick"]`
- **THEN** the tool performs a case-insensitive substring match of `"nick"` against each user's `username`, `displayName`, `github.username`, and each `otherNames` entry
- **AND** performs a case-insensitive exact match against each user's `userId`
- **AND** returns matching users as an array of entries, each at minimum `{ userId, username, displayName, avatarUrl }`

#### Scenario: Search matches a mapped GitHub login

- **WHEN** a user's registry record carries `github.username: "francoislg"`
- **AND** Claude calls `find_user` with `query: ["francoislg"]`
- **THEN** that user is included in the results
- **AND** the match is a case-insensitive substring/wildcard test against `github.username`

#### Scenario: Search matches an alternate name

- **WHEN** a user's registry record carries `otherNames: ["Jo"]`
- **AND** Claude calls `find_user` with `query: ["Jo"]`
- **THEN** that user is included in the results

#### Scenario: Search by multiple terms

- **WHEN** Claude calls `find_user` with `query: ["Nick", "Nich", "Nicolas"]`
- **THEN** the tool matches each term independently against all searchable fields
- **AND** returns the union of all matches, deduplicated by userId

#### Scenario: Search with wildcard

- **WHEN** Claude calls `find_user` with a query term containing `*` (e.g., `"Mi*"`)
- **THEN** the tool treats `*` as a wildcard matching any characters
- **AND** performs a full-field wildcard match against `username`, `displayName`, `github.username`, and each `otherNames` entry
- **AND** does NOT apply wildcard matching to userId (userId is always exact match)

#### Scenario: Result enriched with registry github and otherNames

- **WHEN** a matched user's registry record carries a `github` object and/or `otherNames`
- **THEN** the tool includes the full `github` object and the `otherNames` array on that user's result entry
- **AND** a matched user whose record lacks a field omits that field
- **AND** this enrichment is available to all roles

#### Scenario: Opt-in plugin data projection

- **WHEN** Claude calls `find_user` with `includePluginData: ["trivia"]`
- **AND** the caller's role is `dev` or higher
- **THEN** each result entry includes a `plugins` object populated from the registry record's `plugins.<name>` for each requested, present namespace
- **AND** a requested namespace that is absent for a user contributes nothing for that user (no error)

#### Scenario: Plugin data omitted by default

- **WHEN** `includePluginData` is omitted or empty
- **THEN** no result entry includes a `plugins` field

#### Scenario: Plugin data denied below dev

- **WHEN** a caller whose role is below `dev` calls `find_user` with a non-empty `includePluginData`
- **THEN** the tool does NOT include any plugin data in the response
- **AND** the base identity result (including `github` and `otherNames`) is still returned

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
- **THEN** the response includes `users` (array), `totalCount` (the true number of matches across the whole registry, independent of `offset`/`limit`), `offset` (the echoed page offset), and `hasMore` (true when `offset + users.length < totalCount`)

#### Scenario: No matches found

- **WHEN** no users match any of the provided query terms
- **THEN** the tool returns an empty array with `totalCount: 0` and `hasMore: false`

#### Scenario: Avatar URL usable as image-tool source

- **WHEN** Claude has a user's `avatarUrl` from `find_user`
- **THEN** the tool description indicates the URL can be passed to an image tool (e.g. `generate_image`'s `input_image_url`) as a source/edit image
