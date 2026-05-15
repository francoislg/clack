# Trivia Seasons

## Purpose

Optional competitive "chapters" for the Trivia plugin, modeled as a **timeline of seasons** rather than a single-active-slot. When enabled via `config.trivia.seasons`, the plugin maintains `seasons.json` as a flat array of non-overlapping season intervals; "current" is a derived query against `now`. Every newly-written question/answer/cheat record is tagged with the active season's slug (or omitted in a gap). The reveal flow renders a 3-row Current/All-Time leaderboard and, on the season's last fire, a wrap-up finale before rolling the timeline forward via `upsert_season`. Multiple future seasons can coexist as prepared drafts (no overlap required); admins can refine their dates, names, and category pools before they go live. When disabled, the plugin behaves exactly as it did before this capability existed.

## Requirements

### Requirement: Seasons configuration block

The Trivia plugin SHALL accept an optional `seasons` configuration block at `data/config.json` → `trivia.seasons` with two fields: `enabled` (boolean, default `false`) and `prompt` (string, required when `enabled` is `true`). When `enabled` is `false` or the block is absent, the plugin SHALL behave as it did before this change in every observable respect — no `season` field is written on new records, no `seasons.json` file is created, none of the timeline tools (`check_season_status`, `upsert_season`, `delete_season`, `list_seasons`) appear in any session's MCP catalog, `retrieve_scores` returns only cumulative totals, the reveal leaderboard renders as two rows, and the reveal flow includes no season-finale section.

When `enabled` is `true`, the plugin SHALL load the `prompt` string at startup and pass it into the system prompt context for any session whose tools include `upsert_season`, so Claude has the cadence/style guidance available when deriving a new season's `slug`, `expectedEndAt`, and (when themed) `categories`.

#### Scenario: Seasons disabled by default

- **WHEN** `data/config.json` contains no `trivia.seasons` block
- **THEN** new question/answer/cheat records are written without a `season` field
- **AND** `seasons.json` does not exist
- **AND** sessions do not see `check_season_status`, `upsert_season`, `delete_season`, or `list_seasons` in their MCP catalog
- **AND** the leaderboard table at reveal time renders as two rows (names + scores) per the prior `trivia-scheduled-prompts` shape

#### Scenario: Seasons explicitly disabled

- **WHEN** `data/config.json` contains `trivia.seasons: { enabled: false }`
- **THEN** behavior is identical to the "absent block" case above

#### Scenario: Seasons enabled requires a prompt

- **WHEN** `data/config.json` contains `trivia.seasons: { enabled: true }` with no `prompt` field
- **THEN** the plugin SHALL log a configuration error and SHALL refuse to register the timeline tools
- **AND** the rest of the plugin continues to load normally (seasons-off behavior)

#### Scenario: Seasons enabled with prompt

- **GIVEN** `data/config.json` contains `trivia.seasons: { enabled: true, prompt: "Every month" }`
- **WHEN** the plugin loads
- **THEN** `check_season_status`, `upsert_season`, `delete_season`, and `list_seasons` are registered with the MCP catalog
- **AND** the `prompt` string is available to Claude in sessions that include `upsert_season`

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

### Requirement: check_season_status tool

When `seasons.enabled` is `true`, the Trivia plugin SHALL expose a `check_season_status` MCP tool gated to the `admin` role that returns:

- `currentSlug` (string | null) — the slug of the currently-active season per `findCurrentSeason(state, now)`, or `null` when `now` falls in a gap.
- `currentExpectedEndAt` (number | null) — the active season's `expectedEndAt`, or `null` when there is no current season.
- `isLastFireOfSeason` (boolean) — `true` if and only if there is a current season AND no further cron fire of the trivia reveal schedule scheduled on or before `currentExpectedEndAt` after `now`.
- `nextSeasonSlug` (string | null) — the slug of the season with the smallest `startedAt` strictly greater than the current's `expectedEndAt`, or `null` if no future season is queued.
- `nextSeasonStartsAt` (number | null) — the queued season's `startedAt`, or `null`.
- `isInGap` (boolean) — `true` when `currentSlug` is `null` because `now` falls between two seasons (or after the last season).

#### Scenario: Mid-season reveal with no queued future season

- **GIVEN** one season is active and no future seasons are on the timeline
- **WHEN** `check_season_status` is called mid-season
- **THEN** `currentSlug` and `currentExpectedEndAt` reflect the active season
- **AND** `nextSeasonSlug` and `nextSeasonStartsAt` are `null`
- **AND** `isInGap` is `false`

#### Scenario: Mid-season reveal with a queued future season

- **GIVEN** the active "may-2026" season has `expectedEndAt: May-31` and the timeline also contains "june-2026" with `startedAt: June-1`
- **WHEN** `check_season_status` is called mid-May
- **THEN** `currentSlug` is `"may-2026"`
- **AND** `nextSeasonSlug` is `"june-2026"`
- **AND** `nextSeasonStartsAt` is `June-1`

#### Scenario: Call during a gap returns isInGap true

- **GIVEN** no season's active window contains `now`
- **WHEN** `check_season_status` is called
- **THEN** `currentSlug`, `currentExpectedEndAt`, `isLastFireOfSeason` are `null` / `false`
- **AND** `isInGap` is `true`
- **AND** `nextSeasonSlug` may still be set if a future season exists

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** `check_season_status` is absent from the session's MCP catalog

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

### Requirement: delete_season tool

When `seasons.enabled` is `true`, the Trivia plugin SHALL expose a `delete_season` MCP tool gated to the `admin` role that removes an entry from the seasons timeline. The tool SHALL accept:

- `slug` (string, required) — the slug of the season to delete.

The tool SHALL:

1. Reject the call if `slug` does not match any entry on the timeline (404-style error).
2. Reject the call if the named entry's `startedAt <= now` (past and current seasons are immutable historical records).
3. Reject the call if the named entry is the only entry on the timeline (the plugin requires at least one season to exist while seasons is enabled).
4. Otherwise, remove the named entry from `seasons.json#seasons`.

#### Scenario: Delete a not-yet-started future season

- **GIVEN** the timeline contains active "may-2026" and queued "june-2026" `(startedAt: <June 1>, > now)`
- **WHEN** `delete_season("june-2026")` is called
- **THEN** the call succeeds; `seasons.json#seasons` no longer contains "june-2026"
- **AND** the timeline's other entries are unchanged

#### Scenario: Cannot delete the current season

- **GIVEN** the active "may-2026" season's `startedAt <= now`
- **WHEN** `delete_season("may-2026")` is called
- **THEN** the call is rejected with a "season has already started" error
- **AND** the timeline is unchanged

#### Scenario: Cannot delete a past season

- **GIVEN** the timeline contains an old "spring-2026" entry with `endedAt < now`
- **WHEN** `delete_season("spring-2026")` is called
- **THEN** the call is rejected with a "season has already started" error
- **AND** the timeline is unchanged

#### Scenario: Cannot delete the only season

- **GIVEN** the timeline contains exactly one entry
- **WHEN** `delete_season(<that slug>)` is called
- **THEN** the call is rejected with a "cannot delete the only season" error

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** `delete_season` is absent from the session's MCP catalog

### Requirement: list_seasons tool

When `seasons.enabled` is `true`, the Trivia plugin SHALL expose a `list_seasons` MCP tool gated to the `admin` role that returns every entry on the timeline with full details. The tool SHALL accept no arguments. The return shape SHALL be:

```
{
  seasons: Array<{
    slug: string,
    startedAt: number,
    expectedEndAt: number,
    endedAt: number | null,
    categories: string[],
    status: "past" | "current" | "future"
  }>,
  total: number
}
```

The `status` field is derived per entry against `Date.now()`:

- `"future"` when `startedAt > now`
- `"past"` when `(endedAt ?? expectedEndAt) <= now`
- `"current"` otherwise

Entries SHALL be returned in their stored order (which, under the no-overlap invariant, is the natural timeline order by `startedAt`). The full `categories` array is included for every entry — this is an admin tool used to inspect what's queued and audit category pools.

#### Scenario: Returns every timeline entry with status flags

- **GIVEN** the timeline contains a past season, the active season, and a queued future season
- **WHEN** `list_seasons` is invoked
- **THEN** the response includes all three entries
- **AND** the past entry's `status` is `"past"`
- **AND** the active entry's `status` is `"current"`
- **AND** the future entry's `status` is `"future"`
- **AND** each entry includes its full `categories` array

#### Scenario: Missing seasons.json returns an error

- **WHEN** `list_seasons` is invoked with no `seasons.json` present (seasons disabled)
- **THEN** the tool returns a structured error indicating seasons are not initialized

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** `list_seasons` is absent from the session's MCP catalog

### Requirement: Season tag on new records

When `seasons.enabled` is `true` AND `findCurrentSeason(state, now)` returns a season, the Trivia plugin SHALL stamp `season: <currentSlug>` onto every newly-written record in `questions.json`, `answers.json`, and `cheats.json`. The `season` value SHALL be captured at the moment of write, so a record stamped during one season remains tagged with that slug even after the season has rolled over.

When `findCurrentSeason` returns `null` (timeline gap), new records SHALL NOT carry a `season` field.

`users.json` and `categories.json` SHALL NOT carry a `season` field — users and categories span seasons by design.

#### Scenario: save_question stamps season

- **GIVEN** the currently-active season's slug is `"may-2026"`
- **WHEN** `save_question` is called with valid arguments
- **THEN** the new entry in `questions.json` includes `season: "may-2026"` alongside the existing fields

#### Scenario: submit_answers stamps season on each answer

- **GIVEN** the currently-active season's slug is `"may-2026"`
- **WHEN** `submit_answers` records three new answer entries
- **THEN** each entry in `answers.json` includes `season: "may-2026"`

#### Scenario: save_cheating stamps season

- **GIVEN** the currently-active season's slug is `"may-2026"`
- **WHEN** `save_cheating` records a cheat
- **THEN** the entry in `cheats.json` includes `season: "may-2026"`

#### Scenario: Writes during a gap have no season tag

- **GIVEN** `findCurrentSeason(state, now)` returns `null`
- **WHEN** any tag-stamping tool writes a new entry
- **THEN** the new entry contains no `season` field

#### Scenario: Disabled config skips tagging

- **GIVEN** `seasons.enabled` is `false`
- **WHEN** any tool writes to `questions.json`, `answers.json`, or `cheats.json`
- **THEN** no `season` field is present on the new records

### Requirement: Season-finale section in reveal flow

When `seasons.enabled` is `true` AND `check_season_status` returns `isLastFireOfSeason: true`, the reveal flow SHALL render an additional **season-finale section** above the leaderboard table. The finale section SHALL summarize the closing season — its slug, the season MVP (player at index 0 of the current-season-ordered leaderboard from `retrieve_scores`), and a brief Game-Show-Presenter wrap-up paragraph in the persona's voice. The finale SHALL NOT preview the next season's slug — that is announced only AFTER the reveal flow's final tool calls have run.

When `isLastFireOfSeason` is `false`, no finale section is rendered.

When `seasons.enabled` is `false`, no finale section is rendered and `check_season_status` is not called.

#### Scenario: Mid-season reveal has no finale

- **GIVEN** `seasons.enabled` is `true` and `isLastFireOfSeason` is `false`
- **WHEN** the reveal flow completes
- **THEN** the posted reveal contains no "season finale" header, paragraph, or MVP callout

#### Scenario: Season-end reveal includes finale before leaderboard

- **GIVEN** `seasons.enabled` is `true` and `isLastFireOfSeason` is `true`
- **WHEN** the reveal flow completes
- **THEN** the posted reveal contains a section announcing the closing season's slug and naming the MVP
- **AND** the section appears above the 3-row leaderboard table
- **AND** `upsert_season(currentSlug, { endedAt: now })` is called as the final step

### Requirement: 3-row dual-totals leaderboard rendering

When `seasons.enabled` is `true` AND `findCurrentSeason(state, now)` returns a season, the leaderboard `table` parameter passed to `submit_response` at reveal time SHALL be a 3-row table:

- **Row 1** — empty top-left cell, then one cell per player containing the player's `displayName` (NO medal prefix on this row).
- **Row 2** — left cell text `"Current Season"`, then one cell per player containing `currentSeasonCorrect` as a string, with medal prefix `🥇 `, `🥈 `, `🥉 ` (Unicode characters, not Slack shortcodes) on the player(s) holding the top-3 current-season scores.
- **Row 3** — left cell text `"All Time"`, then one cell per player containing `totalCorrect` as a string, with medal prefix `🥇 `, `🥈 `, `🥉 ` on the player(s) holding the top-3 all-time scores. The all-time medal assignment SHALL be independent of the current-season medal assignment.

Column order SHALL be by `currentSeasonCorrect` descending; ties SHALL be broken by `totalCorrect` descending.

Players who have not participated in the current season (i.e., `currentSeasonCorrect === 0` AND `currentSeasonAnswered === 0`) SHALL be omitted from the table.

`column_settings` SHALL contain one entry per column with `{ "align": "center" }`. Where fewer than 3 players exist in the current season, medals SHALL be assigned in order to whichever players exist.

When `seasons.enabled` is `false` OR `findCurrentSeason` returns `null` (gap), the leaderboard SHALL render as the prior 2-row form (names row + scores row).

#### Scenario: Three-or-more-player season-active reveal

- **GIVEN** the current season has at least three players with non-zero participation
- **AND** Alice has `currentSeasonCorrect: 5, totalCorrect: 20`
- **AND** Bob has `currentSeasonCorrect: 2, totalCorrect: 25`
- **AND** Carol has `currentSeasonCorrect: 1, totalCorrect: 8`
- **WHEN** the reveal renders the leaderboard
- **THEN** the table has 3 rows × 4 columns
- **AND** row 1 is `["", "Alice", "Bob", "Carol"]` (no medals on the names row)
- **AND** row 2 is `["Current Season", "🥇 5", "🥈 2", "🥉 1"]`
- **AND** row 3 is `["All Time", "🥈 20", "🥇 25", "🥉 8"]` (Bob is the all-time #1 despite Alice's current-season #1)

#### Scenario: Player with 0 current-season is omitted

- **GIVEN** Dave has `currentSeasonCorrect: 0`, `currentSeasonAnswered: 0`, `totalCorrect: 50`
- **WHEN** the reveal renders the leaderboard
- **THEN** Dave does NOT appear as a column

#### Scenario: Fewer than three current-season players

- **GIVEN** only two players have current-season participation: Alice (5) and Bob (2)
- **WHEN** the reveal renders the leaderboard
- **THEN** the Current Season row is `["Current Season", "🥇 5", "🥈 2"]` (no 🥉)
- **AND** the All Time row uses medals only for the all-time top 2 among present players

#### Scenario: Seasons disabled retains 2-row leaderboard

- **GIVEN** `seasons.enabled` is `false`
- **WHEN** the reveal renders the leaderboard
- **THEN** the table has 2 rows (names + scores) per the prior `trivia-scheduled-prompts` shape
- **AND** no "Current Season" / "All Time" labels appear

### Requirement: First-enable plugin initialization

The Trivia plugin SHALL initialize `seasons.json` directly during its load function on the first boot after `trivia.seasons.enabled` is observed `true`. The initialization SHALL:

1. Check whether `seasons.json` already exists; if so, exit no-op (idempotent).
2. Compute a deterministic initial slug `season-YYYY-MM` based on the current UTC month.
3. Compute a deterministic initial `expectedEndAt` at end-of-current-UTC-month (`23:59:59.999`).
4. Compute `categories` as a copy of the current `categories.json` (the persistent baseline pool).
5. Write `seasons.json` with `{ seasons: [{ slug, startedAt: Date.now(), expectedEndAt, categories }] }`.

Pre-existing entries in `questions.json` / `answers.json` / `cheats.json` are NOT backfilled with a `season` field — they remain untagged and contribute to all-time totals only.

#### Scenario: First enable on a populated deployment

- **GIVEN** a deployment with populated `questions.json`, `answers.json`, `cheats.json` and no `seasons.json`
- **WHEN** `trivia.seasons.enabled` is changed from `false` to `true` and the app boots
- **THEN** `seasons.json` is created with `seasons: [{ slug: "season-<YYYY>-<MM>", ... }]` matching the current UTC month
- **AND** the `categories` array on that entry is a copy of `categories.json`
- **AND** pre-existing entries in the three data files remain unchanged

#### Scenario: Idempotent re-boot

- **GIVEN** the initialization has already run once and `seasons.json` exists
- **WHEN** the app boots again
- **THEN** the initialization detects `seasons.json` and exits without modifying any data file

#### Scenario: First enable on a fresh deployment

- **GIVEN** a deployment with empty data files and no `seasons.json`
- **WHEN** `trivia.seasons.enabled` is `true` and the app boots
- **THEN** `seasons.json` is created with a non-empty `current` slug, a single entry whose `categories` is seeded from the seed-category pool

### Requirement: trivia-check instruction advertises timeline management

When `seasons.enabled` is `true`, the `trivia-check` instruction registered by the Trivia plugin SHALL include guidance directing admins how to manage the timeline. The instruction SHALL reference:

- `upsert_season` for preparing future seasons (and updating not-yet-started ones).
- `delete_season` for retracting a not-yet-started future season.
- `list_seasons` for inspecting the full timeline including each season's category list.
- `add_categories({ target: "<slug>" })` / `remove_categories({ target: "<slug>" })` for editing a queued season's pool after creation.
- The semantics that `categories` on `upsert_season` REPLACES the baseline (for themed seasons); omitting it copies the baseline.

When `seasons.enabled` is `false`, the instruction SHALL NOT include this guidance.

#### Scenario: Instruction includes timeline guidance when enabled

- **GIVEN** `seasons.enabled` is `true`
- **WHEN** a session loads the `trivia-check` instruction
- **THEN** the resolved instruction text references `upsert_season`, `delete_season`, and `list_seasons` by name
- **AND** the instruction does NOT reference `start_new_season` (obsolete)

#### Scenario: Instruction omits guidance when disabled

- **GIVEN** `seasons.enabled` is `false`
- **WHEN** a session loads the `trivia-check` instruction
- **THEN** the resolved instruction text does NOT reference any timeline tools
