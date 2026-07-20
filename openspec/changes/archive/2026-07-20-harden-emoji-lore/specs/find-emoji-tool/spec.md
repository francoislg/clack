# find-emoji-tool Specification (delta)

## ADDED Requirements

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
