## MODIFIED Requirements

### Requirement: seasons.json file schema

When `seasons.enabled` is `true`, the Trivia plugin SHALL maintain a file `data/plugins/trivia/seasons.json` whose schema is:

```
{
  "seasons": Array<{
    "slug": string,                          // unique non-empty kebab-case identifier
    "startedAt": number,                     // unix-ms when the season's active window begins
    "expectedEndAt": number,                 // unix-ms when the season's active window is expected to close
    "endedAt": number?,                      // unix-ms when the season was actually closed; absent for not-yet-ended seasons
    "categories": string[],                  // the season's category pool (non-empty)
    "questionTypes": Record<"boolean" | "choice", number>?
                                             // OPTIONAL per-season question-type weights; when absent, get_ideas falls back to config.trivia.questionsTypes
  }>
}
```

Invariants (enforced by `upsert_season` at write time):

1. Slug uniqueness across the array — no two entries share the same `slug`.
2. Each entry satisfies `startedAt < expectedEndAt`.
3. Each entry's `categories` array is non-empty.
4. No two entries' active windows `[startedAt, endedAt ?? expectedEndAt)` overlap.
5. When present, each entry's `questionTypes` map SHALL contain only the keys `"boolean"` and `"choice"`, each mapped to a non-negative integer (zero is allowed and means "never roll this type"), AND at least one key SHALL be mapped to a strictly positive value (a map with all-zero weights is invalid — there must be something to roll).

The file SHALL be created by the plugin's first-enable initialization with exactly one entry; subsequent mutations flow exclusively through `upsert_season`, `delete_season`, `add_categories`, and `remove_categories`.

The "current season" at any moment is a *derived* concept: the unique entry where `startedAt <= now < (endedAt ?? expectedEndAt)`, or `null` if `now` falls in a gap between entries.

#### Scenario: First-enable creates seasons.json with one entry

- **GIVEN** seasons are being enabled for the first time on a deployment
- **WHEN** the plugin boots and observes `trivia.seasons.enabled` true with no `seasons.json` present
- **THEN** `data/plugins/trivia/seasons.json` is created before the plugin finishes loading
- **AND** the file contains a `seasons` array with exactly one entry
- **AND** the entry's `slug` is non-empty, `startedAt < expectedEndAt`, `categories` is a copy of `categories.json`
- **AND** the entry has no `questionTypes` field (so `get_ideas` initially falls back to `config.trivia.questionsTypes`)

#### Scenario: No-overlap invariant is enforced at write time

- **GIVEN** `seasons.json` contains an entry `{ slug: "may-2026", startedAt: T1, expectedEndAt: T3 }`
- **WHEN** `upsert_season` is called with `slug: "june-2026", startedAt: T2, expectedEndAt: T4` where `T1 < T2 < T3 < T4` (overlap)
- **THEN** the tool returns a structured overlap error
- **AND** `seasons.json` is unchanged

#### Scenario: Back-to-back seasons are permitted (touching but not overlapping)

- **GIVEN** `seasons.json` contains `{ slug: "may-2026", expectedEndAt: T }`
- **WHEN** `upsert_season` is called with `slug: "june-2026", startedAt: T, expectedEndAt: T+30days`
- **THEN** the tool succeeds and the file gains the new entry

#### Scenario: Gap between seasons leaves current null

- **GIVEN** `seasons.json` contains May with `expectedEndAt: May-31` and June with `startedAt: June-2`
- **WHEN** `now` is `June-1` (in the gap)
- **THEN** `findCurrentSeason(state, now)` returns `null`
- **AND** new question/answer/cheat writes during this window have no `season` field

#### Scenario: Slug uniqueness is enforced

- **GIVEN** `seasons.json` contains an entry with `slug: "summer-2026"`
- **WHEN** `upsert_season` is called with `slug: "summer-2026"` and `startedAt`/`expectedEndAt` provided AS IF creating
- **THEN** the call is treated as an UPDATE of the existing entry, not as a duplicate-slug error
- **AND** the existing entry's other fields are updated per the call

#### Scenario: Invalid questionTypes map is rejected

- **WHEN** an entry would be written with `questionTypes: { "boolean": 0, "choice": 0 }` (all-zero weights)
- **THEN** the write is rejected with a "questionTypes must have at least one positive weight" error
- **AND** the file is unchanged

#### Scenario: questionTypes with unknown keys is rejected

- **WHEN** an entry would be written with `questionTypes: { "boolean": 1, "trivia": 1 }` (unknown key)
- **THEN** the write is rejected with a "questionTypes keys must be 'boolean' or 'choice'" error
- **AND** the file is unchanged

### Requirement: upsert_season tool

When `seasons.enabled` is `true`, the Trivia plugin SHALL expose an `upsert_season` MCP tool gated to the `admin` role that creates a new season or updates an existing one. The tool SHALL accept:

- `slug` (string, required) — non-empty kebab-case identifier. Treated as immutable: if the slug already exists, the call is an update of that entry; otherwise the call creates a new entry. Slug renaming is not supported (use `delete_season` + a new `upsert_season` for a not-yet-started entry).
- `startedAt` (number, optional, unix-ms) — required on CREATE; on UPDATE, modifying it is rejected if the existing entry's `startedAt <= now` (the past is immutable).
- `expectedEndAt` (number, optional, unix-ms) — required on CREATE; on UPDATE, the new value MUST still satisfy `startedAt < (endedAt ?? newExpectedEndAt)`.
- `endedAt` (number, optional, unix-ms) — sets the actual end time. Used to mark a season as closed (e.g. at the last-fire reveal or for early termination by an admin).
- `themeExtras` (string[], optional) — themed categories layered on top of the `categories.json` baseline. Used only on CREATE; ignored on UPDATE (use `add_categories` / `remove_categories` to refine an existing season's pool).
- `questionTypes` (`Record<"boolean" | "choice", number>`, optional) — per-season question-type weights. On CREATE, stored verbatim on the new entry. On UPDATE, replaces the entry's existing `questionTypes` value (or sets it for the first time). Passing `questionTypes: null` on UPDATE clears the entry's `questionTypes` field, causing `get_ideas` to fall back to `config.trivia.questionsTypes` for that entry going forward. Mutating `questionTypes` on a season whose `startedAt <= now` IS PERMITTED (unlike `startedAt`) — mid-season `questionTypes` tweaks are an explicit goal of this design.

The tool SHALL:

1. Validate that `slug` is non-empty kebab-case.
2. Load `seasons.json` (initialize from scratch if missing — same shape as first-enable init).
3. If creating: require both `startedAt` and `expectedEndAt`; compute `categories = unique([...categories.json, ...(themeExtras ?? [])])` (preserving first-occurrence order); reject if the resulting list is empty; verify the new entry's `[startedAt, endedAt ?? expectedEndAt)` interval does not overlap any existing entry's interval; if `questionTypes` is provided, validate per the schema invariants (only `"boolean"` and `"choice"` keys; all values non-negative integers; at least one positive).
4. If updating: load the existing entry, apply the passed fields (omit-to-keep semantics for non-null fields; explicit `null` for `questionTypes` clears the field), re-validate the same invariants (`startedAt < (endedAt ?? expectedEndAt)`, no overlap with other entries excluding self, `categories` still non-empty, `questionTypes` valid when present), and reject any attempt to mutate `startedAt` of an already-started season.
5. Atomically write the new `seasons.json`.

Return shape: `{ slug, action: "created" | "updated", startedAt, expectedEndAt, endedAt, categoriesCount, hasQuestionTypes }`. (`hasQuestionTypes` is a convenience boolean for the caller — equivalent to `questionTypes !== undefined` on the stored entry.)

#### Scenario: Create a future season with questionTypes

- **GIVEN** the timeline contains only the active "may-2026" season
- **WHEN** `upsert_season` is called with `slug: "june-2026", startedAt: <June 1>, expectedEndAt: <June 30 23:59>, questionTypes: { "boolean": 2, "choice": 1 }`
- **THEN** the response is `{ slug: "june-2026", action: "created", hasQuestionTypes: true, ... }`
- **AND** the new entry carries `questionTypes: { "boolean": 2, "choice": 1 }`

#### Scenario: Create a future season without questionTypes

- **WHEN** `upsert_season` is called without a `questionTypes` argument
- **THEN** the response is `{ ..., hasQuestionTypes: false }`
- **AND** the new entry has no `questionTypes` field (so `get_ideas` falls back to config for sessions during that entry's active window)

#### Scenario: Update a season's questionTypes mid-season

- **GIVEN** the active "may-2026" season has `startedAt <= now` and `questionTypes: { "boolean": 1 }`
- **WHEN** `upsert_season("may-2026", { questionTypes: { "choice": 1 } })` is called
- **THEN** the response is `{ slug: "may-2026", action: "updated", hasQuestionTypes: true, ... }`
- **AND** the entry's `questionTypes` is now `{ "choice": 1 }`
- **AND** the next `get_ideas` call rolls only `"choice"` types
- **AND** the entry's `startedAt` and `categories` are unchanged

#### Scenario: Clear a season's questionTypes by passing null

- **GIVEN** the active "may-2026" season has `questionTypes: { "choice": 1 }`
- **WHEN** `upsert_season("may-2026", { questionTypes: null })` is called
- **THEN** the entry's `questionTypes` field is removed
- **AND** the response carries `hasQuestionTypes: false`
- **AND** subsequent `get_ideas` calls fall back to `config.trivia.questionsTypes`

#### Scenario: questionTypes with all-zero weights rejected

- **WHEN** `upsert_season` is called with `questionTypes: { "boolean": 0, "choice": 0 }`
- **THEN** the call is rejected with a "questionTypes must have at least one positive weight" error
- **AND** the timeline is unchanged

#### Scenario: questionTypes with unknown keys rejected

- **WHEN** `upsert_season` is called with `questionTypes: { "boolean": 1, "essay": 1 }`
- **THEN** the call is rejected with a "questionTypes keys must be 'boolean' or 'choice'" error
- **AND** the timeline is unchanged

#### Scenario: Update a future season's expected end

- **GIVEN** the timeline contains a future "june-2026" season with `expectedEndAt: June-30`
- **WHEN** `upsert_season` is called with `slug: "june-2026", expectedEndAt: <July 7>`
- **THEN** the response is `{ slug: "june-2026", action: "updated", ... }`
- **AND** the entry's `expectedEndAt` is updated; its `startedAt`, `categories`, and `questionTypes` are unchanged

#### Scenario: Update an existing season's endedAt (mark closed)

- **GIVEN** the active "may-2026" season has no `endedAt`
- **WHEN** `upsert_season` is called with `slug: "may-2026", endedAt: <now>`
- **THEN** the entry's `endedAt` is set to the provided value
- **AND** `findCurrentSeason(state, now)` no longer returns "may-2026" if `endedAt <= now`

#### Scenario: Overlap rejection on update

- **GIVEN** the timeline contains "may-2026" `[May-1, May-31]` and "june-2026" `[June-1, June-30]`
- **WHEN** `upsert_season("may-2026", { expectedEndAt: <June 15> })` is called
- **THEN** the call is rejected with an overlap error (the proposed window overlaps june-2026)
- **AND** the timeline is unchanged

#### Scenario: Cannot mutate startedAt of an already-started season

- **GIVEN** the active "may-2026" season has `startedAt: <April 24>` (in the past)
- **WHEN** `upsert_season("may-2026", { startedAt: <April 26> })` is called
- **THEN** the call is rejected with a "cannot shift the past" error
- **AND** the timeline is unchanged

#### Scenario: Themed extras layered with baseline on create

- **GIVEN** `categories.json` contains `["Science", "History", "Geography"]`
- **WHEN** `upsert_season("marine-2026-06", <June 1>, <June 30>, themeExtras: ["Cephalopods", "Science"])` is called (note: "Science" duplicates the baseline)
- **THEN** the resulting entry's `categories` is `["Science", "History", "Geography", "Cephalopods"]` (no duplicate, themed extras appended after baseline)

#### Scenario: Empty resulting pool rejected on create

- **GIVEN** `categories.json` is empty and no `themeExtras` are provided
- **WHEN** `upsert_season` is called as a create
- **THEN** the call is rejected with a "season must have at least one category" error

#### Scenario: Invalid slug rejected

- **WHEN** `upsert_season` is called with `slug: "Has Spaces"` or `"UPPER"` or `""`
- **THEN** the call is rejected with a slug-format error

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** `upsert_season` is absent from the session's MCP catalog
