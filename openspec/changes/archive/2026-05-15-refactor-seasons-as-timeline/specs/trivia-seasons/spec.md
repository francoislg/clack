## MODIFIED Requirements

### Requirement: seasons.json file schema

When `seasons.enabled` is `true`, the Trivia plugin SHALL maintain a file `data/plugins/trivia/seasons.json` whose schema is:

```
{
  "seasons": Array<{
    "slug": string,           // unique non-empty kebab-case identifier
    "startedAt": number,      // unix-ms when the season's active window begins
    "expectedEndAt": number,  // unix-ms when the season's active window is expected to close
    "endedAt": number?,       // unix-ms when the season was actually closed; absent for not-yet-ended seasons
    "categories": string[]    // the season's category pool (non-empty)
  }>
}
```

Invariants (enforced by `upsert_season` at write time):

1. Slug uniqueness across the array — no two entries share the same `slug`.
2. Each entry satisfies `startedAt < expectedEndAt`.
3. Each entry's `categories` array is non-empty.
4. No two entries' active windows `[startedAt, endedAt ?? expectedEndAt)` overlap.

The file SHALL be created by the plugin's first-enable initialization with exactly one entry; subsequent mutations flow exclusively through `upsert_season`, `delete_season`, `add_categories`, and `remove_categories`.

The "current season" at any moment is a *derived* concept: the unique entry where `startedAt <= now < (endedAt ?? expectedEndAt)`, or `null` if `now` falls in a gap between entries.

#### Scenario: First-enable creates seasons.json with one entry

- **GIVEN** seasons are being enabled for the first time on a deployment
- **WHEN** the plugin boots and observes `trivia.seasons.enabled` true with no `seasons.json` present
- **THEN** `data/plugins/trivia/seasons.json` is created before the plugin finishes loading
- **AND** the file contains a `seasons` array with exactly one entry
- **AND** the entry's `slug` is non-empty, `startedAt < expectedEndAt`, `categories` is a copy of `categories.json`

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

### Requirement: upsert_season tool

When `seasons.enabled` is `true`, the Trivia plugin SHALL expose an `upsert_season` MCP tool gated to the `admin` role that creates a new season or updates an existing one. The tool SHALL accept:

- `slug` (string, required) — non-empty kebab-case identifier. Treated as immutable: if the slug already exists, the call is an update of that entry; otherwise the call creates a new entry. Slug renaming is not supported (use `delete_season` + a new `upsert_season` for a not-yet-started entry).
- `startedAt` (number, optional, unix-ms) — required on CREATE; on UPDATE, modifying it is rejected if the existing entry's `startedAt <= now` (the past is immutable).
- `expectedEndAt` (number, optional, unix-ms) — required on CREATE; on UPDATE, the new value MUST still satisfy `startedAt < (endedAt ?? newExpectedEndAt)`.
- `endedAt` (number, optional, unix-ms) — sets the actual end time. Used to mark a season as closed (e.g. at the last-fire reveal or for early termination by an admin).
- `categories` (string[], optional) — the season's category pool. When provided AND non-empty, the new season's pool is **exactly** that list (replace, not augment — for purely themed seasons). When omitted OR empty, the new season's pool is copied from `categories.json` (the persistent baseline). Used only on CREATE; ignored on UPDATE (use `add_categories` / `remove_categories` with `target: <slug>` to refine an existing season's pool).

The tool SHALL:

1. Validate that `slug` is non-empty kebab-case.
2. Load `seasons.json` (initialize from scratch if missing — same shape as first-enable init).
3. If creating: require both `startedAt` and `expectedEndAt`. Categories source — if `categories` arg is provided AND non-empty, use exactly that list (deduped, preserving first-occurrence order); otherwise copy `categories.json`. Reject if the resulting list is empty. Verify the new entry's `[startedAt, endedAt ?? expectedEndAt)` interval does not overlap any existing entry's interval.
4. If updating: load the existing entry, apply the passed fields (omit-to-keep semantics), re-validate the same invariants (`startedAt < (endedAt ?? expectedEndAt)`, no overlap with other entries excluding self, `categories` still non-empty), and reject any attempt to mutate `startedAt` of an already-started season.
5. Atomically write the new `seasons.json`.

Return shape: `{ slug, action: "created" | "updated", startedAt, expectedEndAt, endedAt, categoriesCount }`.

#### Scenario: Create a future season

- **GIVEN** the timeline contains only the active "may-2026" season
- **WHEN** `upsert_season` is called with `slug: "june-2026", startedAt: <June 1>, expectedEndAt: <June 30 23:59>, categories: ["Cephalopods", "Coral Reefs", "Tides", ...20 themed entries]`
- **THEN** the response is `{ slug: "june-2026", action: "created", ... }`
- **AND** the timeline now contains both seasons
- **AND** "june-2026"'s `categories` equals exactly the provided list (no baseline mixing)

#### Scenario: Create a non-themed season (omit categories → copy baseline)

- **GIVEN** `categories.json` contains 50 baseline entries
- **WHEN** `upsert_season` is called with `slug: "july-2026", startedAt: <Jul 1>, expectedEndAt: <Jul 31 23:59>` (no `categories` arg)
- **THEN** the new entry's `categories` is a copy of `categories.json` (50 entries)

#### Scenario: Update a future season's expected end

- **GIVEN** the timeline contains a future "june-2026" season with `expectedEndAt: June-30`
- **WHEN** `upsert_season` is called with `slug: "june-2026", expectedEndAt: <July 7>`
- **THEN** the response is `{ slug: "june-2026", action: "updated", ... }`
- **AND** the entry's `expectedEndAt` is updated; its `startedAt` and `categories` are unchanged

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

#### Scenario: Themed `categories` replace baseline (not augment), deduped

- **GIVEN** `categories.json` contains `["Science", "History", "Geography"]`
- **WHEN** `upsert_season("marine-2026-06", <June 1>, <June 30>, categories: ["Cephalopods", "Cephalopods", "Tides"])` is called (note: duplicate "Cephalopods")
- **THEN** the resulting entry's `categories` is `["Cephalopods", "Tides"]` — duplicates collapsed, baseline categories NOT mixed in
- **AND** `categories.json` remains unchanged

#### Scenario: Empty resulting pool rejected on create

- **GIVEN** `categories.json` is empty AND `categories` arg is omitted (or empty)
- **WHEN** `upsert_season` is called as a create
- **THEN** the call is rejected with a "season must have at least one category" error

#### Scenario: Invalid slug rejected

- **WHEN** `upsert_season` is called with `slug: "Has Spaces"` or `"UPPER"` or `""`
- **THEN** the call is rejected with a slug-format error

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** `upsert_season` is absent from the session's MCP catalog

### Requirement: Season-finale section in reveal flow

When `seasons.enabled` is `true` AND `check_season_status` returns `isLastFireOfSeason: true`, the reveal flow SHALL render an additional **season-finale section** above the leaderboard table. The finale section SHALL summarize the closing season — its slug, the season's MVP (highest `currentSeasonCorrect` per `retrieve_scores`), and a brief Game-Show-Presenter wrap-up paragraph in the persona's voice. The finale SHALL NOT preview the next season's slug — that is announced only AFTER step 13 has run.

When `isLastFireOfSeason` is `false`, no finale section is rendered.

When `seasons.enabled` is `false`, no finale section is rendered and `check_season_status` is not called.

The requirement language and scenarios from the original `add-trivia-seasons` capability remain in force — only the schema/tool surface has changed. The finale still renders above a 3-row leaderboard; medals are still independent per row; column ordering is still by `currentSeasonCorrect` descending.

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

### Requirement: First-enable plugin initialization

The Trivia plugin SHALL initialize `seasons.json` directly during its load function on the first boot after `trivia.seasons.enabled` is observed `true`. The initialization SHALL:

1. Check whether `seasons.json` already exists; if so, exit no-op (idempotent).
2. Compute a deterministic initial slug `season-YYYY-MM` based on the current UTC month.
3. Compute a deterministic initial `expectedEndAt` at end-of-current-UTC-month (`23:59:59.999`).
4. Compute `categories` as a copy of the current `categories.json`.
5. Write `seasons.json` with `{ seasons: [{ slug, startedAt: Date.now(), expectedEndAt, categories }] }`.

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

## ADDED Requirements

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

Entries SHALL be returned in their stored order (which, under the no-overlap invariant, is the natural timeline order by `startedAt`). The full `categories` array is included for every entry — this is an admin tool used to inspect what's queued and audit category pools, so the full data is the point.

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

### Requirement: delete_season tool

When `seasons.enabled` is `true`, the Trivia plugin SHALL expose a `delete_season` MCP tool gated to the `admin` role that removes an entry from the seasons timeline. The tool SHALL accept:

- `slug` (string, required) — the slug of the season to delete.

The tool SHALL:

1. Reject the call if `slug` does not match any entry on the timeline (404-style error).
2. Reject the call if the named entry's `startedAt <= now` (past and current seasons are immutable historical records).
3. Reject the call if the named entry is the only entry on the timeline AND `seasons.enabled` is true (the plugin requires at least one season to exist while seasons is enabled, otherwise `findCurrentSeason` would always return `null`).
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

- **GIVEN** the timeline contains exactly one entry (the active season)
- **WHEN** `delete_season(<that slug>)` is called
- **THEN** the call is rejected with a "cannot delete the only season" error

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** `delete_season` is absent from the session's MCP catalog

## REMOVED Requirements

### Requirement: start_new_season tool

**Reason:** Replaced by the more general `upsert_season` primitive. The destructive close-current-and-create-new transition that `start_new_season` performed is now expressible as `upsert_season(currentSlug, { endedAt: now })` followed by `upsert_season(<new slug>, { startedAt: now, expectedEndAt: ..., themeExtras: ... })`. Both operations preserve and extend the timeline rather than mutating a special "current" slot.

**Migration:** Sessions previously calling `start_new_season(slug, expectedEndAt, themeExtras?)` SHALL be rewritten to call:

1. `upsert_season(currentSlug, { endedAt: now })` — close the active season.
2. `upsert_season(slug, { startedAt: now, expectedEndAt, categories? })` — create the new one starting immediately. Note the parameter rename and semantics change: `themeExtras` (additive on top of baseline) is gone; `categories` (replace if provided, baseline if omitted) is the new shape.

The same-day no-op guard from the old tool is no longer needed: duplicate same-day calls would either be no-ops by virtue of `endedAt` already being set (step 1 is idempotent), or would be rejected by the no-overlap check (step 2's new season would conflict with whatever is now current).
