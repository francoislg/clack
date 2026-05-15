## ADDED Requirements

### Requirement: Seasons configuration block

The Trivia plugin SHALL accept an optional `seasons` configuration block at `data/config.json` → `trivia.seasons` with two fields: `enabled` (boolean, default `false`) and `prompt` (string, required when `enabled` is `true`). When `enabled` is `false` or the block is absent, the plugin SHALL behave as it did before this change in every observable respect — no `season` field is written on new records, no `seasons.json` file is created, neither `check_season_status` nor `start_new_season` appears in any session's MCP catalog, `retrieve_scores` returns only cumulative totals, the reveal leaderboard renders as two rows, and the reveal flow includes no season-finale section.

When `enabled` is `true`, the plugin SHALL load the `prompt` string at startup and pass it into the system prompt context for any session whose tools include `start_new_season`, so Claude has the cadence/style guidance available when it derives a new season's `slug` and `expectedEndAt`.

#### Scenario: Seasons disabled by default

- **WHEN** `data/config.json` contains no `trivia.seasons` block
- **THEN** new question/answer/cheat records are written without a `season` field
- **AND** `seasons.json` does not exist
- **AND** sessions do not see `check_season_status` or `start_new_season` in their MCP catalog
- **AND** the leaderboard table at reveal time renders as two rows (names + scores) per the prior `trivia-scheduled-prompts` shape

#### Scenario: Seasons explicitly disabled

- **WHEN** `data/config.json` contains `trivia.seasons: { enabled: false }`
- **THEN** behavior is identical to the "absent block" case above

#### Scenario: Seasons enabled requires a prompt

- **WHEN** `data/config.json` contains `trivia.seasons: { enabled: true }` with no `prompt` field
- **THEN** the plugin SHALL log a configuration error and SHALL refuse to register `start_new_season` and `check_season_status`
- **AND** the rest of the plugin continues to load normally (seasons-off behavior)

#### Scenario: Seasons enabled with prompt

- **GIVEN** `data/config.json` contains `trivia.seasons: { enabled: true, prompt: "Every month" }`
- **WHEN** the plugin loads
- **THEN** `check_season_status` and `start_new_season` are registered with the MCP catalog
- **AND** the `prompt` string is available to Claude in sessions that include `start_new_season`

### Requirement: seasons.json file schema

When `seasons.enabled` is `true`, the Trivia plugin SHALL maintain a file `data/plugins/trivia/seasons.json` whose schema is:

```
{
  "current": string,                   // the active season's slug
  "currentStartedAt": number,          // unix-ms when the active season began
  "currentExpectedEndAt": number,      // unix-ms when the active season is expected to end
  "currentCategories": string[],       // the active season's category pool (used by get_ideas / save_question)
  "history": Array<{
    "slug": string,
    "startedAt": number,
    "expectedEndAt": number,           // the timestamp recorded when the season was created
    "endedAt": number,                 // the timestamp when the season was actually closed
    "categories": string[]             // snapshot of the season's pool at close time
  }>
}
```

Slug uniqueness across `current` and every `history[].slug` SHALL be enforced. `currentExpectedEndAt` SHALL always be strictly greater than `currentStartedAt`. `currentCategories` SHALL be a non-empty array — a season with zero categories is invalid because `get_ideas` would have nothing to return. The file SHALL be created by the plugin's first-enable initialization (a one-shot write performed by the plugin at boot when `seasons.enabled` is observed `true` and `seasons.json` does not yet exist); subsequent edits to `current*`, `history`, and `currentCategories` SHALL flow through `start_new_season`, `add_categories`, and `remove_categories` (the plugin SHALL NOT mutate `seasons.json` from other code paths during normal operation).

#### Scenario: First-enable creates seasons.json

- **GIVEN** seasons are being enabled for the first time on a deployment
- **WHEN** the plugin boots and observes `trivia.seasons.enabled` true with no `seasons.json` present
- **THEN** `data/plugins/trivia/seasons.json` is created before the plugin finishes loading
- **AND** `current` is a non-empty slug string
- **AND** `currentStartedAt` and `currentExpectedEndAt` are present and `currentExpectedEndAt > currentStartedAt`
- **AND** `currentCategories` is initialized to a copy of `categories.json` (the persistent baseline pool)
- **AND** `history` is an empty array

#### Scenario: Slug uniqueness is enforced

- **GIVEN** `seasons.json` exists with `current: "summer-2026"` and history containing `{ slug: "spring-2026", ... }`
- **WHEN** `start_new_season` is called with `slug: "summer-2026"` or `slug: "spring-2026"`
- **THEN** the tool returns a structured error indicating the slug is already in use
- **AND** `seasons.json` is unchanged

### Requirement: check_season_status tool

When `seasons.enabled` is `true`, the Trivia plugin SHALL expose a `check_season_status` MCP tool gated to the `admin` role that returns the current season's slug, its expected end timestamp, and a boolean indicating whether today's reveal is the last fire of the current season.

The tool SHALL accept no arguments and SHALL return:

- `currentSlug` (string) — the value of `seasons.json#current`.
- `currentExpectedEndAt` (number, unix-ms) — the value of `seasons.json#currentExpectedEndAt`.
- `isLastFireOfSeason` (boolean) — `true` if and only if there is no further cron fire of the trivia reveal schedule scheduled on or before `currentExpectedEndAt` after the present moment.

The `isLastFireOfSeason` determination SHALL be made by reading the trivia reveal schedule's cron expression and timezone from the scheduled-messages registry (via the same utility that backs `create_scheduled_message` / `list_scheduled_messages`) and iterating it forward from `now` to find the first fire strictly after `now`. If that fire's timestamp is greater than `currentExpectedEndAt`, or if no fire exists in that range, `isLastFireOfSeason` SHALL be `true`. Otherwise it SHALL be `false`. When multiple trivia schedules exist in a deployment, the determination SHALL be made against the schedule whose `prompt` references `process_responses_instructions` (i.e., the reveal schedule).

#### Scenario: Mid-season reveal

- **GIVEN** `seasons.json#current` is `"august-2026"` with `currentExpectedEndAt` corresponding to Aug 31 23:59
- **AND** the reveal cron is `"0 18 * * 1-5"` (weekdays 6 PM)
- **AND** today is Aug 14, 2026 (Friday)
- **WHEN** `check_season_status` is called
- **THEN** `isLastFireOfSeason` is `false` (next fire is Aug 17 18:00, well before Aug 31)

#### Scenario: Last weekday of the month, end of month is a weekday

- **GIVEN** `currentExpectedEndAt` corresponds to Aug 31, 2026 23:59 (Monday)
- **AND** the reveal cron is `"0 18 * * 1-5"`
- **AND** today is Aug 31, 2026 (Monday)
- **WHEN** `check_season_status` is called after the 18:00 reveal start
- **THEN** `isLastFireOfSeason` is `true` (the next fire would be Sep 1, past the expected end)

#### Scenario: Last weekday of the month, end of month is a weekend

- **GIVEN** `currentExpectedEndAt` corresponds to May 31, 2026 23:59 (Sunday)
- **AND** the reveal cron is `"0 18 * * 1-5"`
- **AND** today is May 29, 2026 (Friday) — the last weekday of the month
- **WHEN** `check_season_status` is called after the 18:00 reveal start
- **THEN** `isLastFireOfSeason` is `true` (the next fire is Mon Jun 1, past the May 31 expected end)

#### Scenario: Reveal cron fires on a weekend in the month

- **GIVEN** `currentExpectedEndAt` corresponds to Aug 31, 2026 23:59
- **AND** the reveal cron is `"0 18 * * *"` (daily)
- **AND** today is Aug 30, 2026 (Saturday)
- **WHEN** `check_season_status` is called
- **THEN** `isLastFireOfSeason` is `false` (next fire is Aug 31 at 18:00)

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** `check_season_status` is absent from the session's MCP catalog

### Requirement: start_new_season tool

When `seasons.enabled` is `true`, the Trivia plugin SHALL expose a `start_new_season` MCP tool gated to the `admin` role that closes the current season and promotes a new one. The tool SHALL accept:

- `slug` (string, required) — the new season's slug. MUST be non-empty kebab-case, MUST be unique across `current` and every `history[].slug`.
- `expectedEndAt` (number, required, unix-ms) — the new season's expected end. MUST be strictly greater than `Date.now()` at the moment of the call.
- `themeExtras` (string[], optional) — additional themed categories layered on top of the `categories.json` baseline for the new season. When omitted or empty, the new season uses just the baseline pool. The combined pool (`unique([...categories.json, ...themeExtras])`) MUST contain at least one category — `start_new_season` SHALL return a validation error if the resulting list would be empty.

The tool SHALL atomically:

1. Append the *previous* season as `{ slug, startedAt, expectedEndAt, endedAt: Date.now(), categories: <prev.currentCategories> }` to `history`.
2. Overwrite `current` with the new slug, `currentStartedAt` with `Date.now()`, `currentExpectedEndAt` with the provided `expectedEndAt`, and `currentCategories` with `unique([...categories.json, ...(themeExtras ?? [])])` (preserving first-occurrence order, case-sensitive).

The tool SHALL return:

- `previousSlug` (string) — the slug just closed.
- `currentSlug` (string) — the new slug now active.
- `currentExpectedEndAt` (number) — echoed for confirmation.

The tool SHALL be no-op on duplicate same-day invocation: if `current.startedAt` falls within the current calendar day in the schedule's timezone, the tool SHALL return `{ noop: true, currentSlug, currentExpectedEndAt }` and SHALL NOT mutate `seasons.json`.

#### Scenario: Auto-triggered rollover at season's last fire

- **GIVEN** the reveal flow has just completed for the last-fire-of-season reveal
- **AND** `seasons.json#current` is `"august-2026"` with `currentStartedAt: T0`, `currentExpectedEndAt: T1`, and `currentCategories: [...]`
- **WHEN** Claude calls `start_new_season(slug: "september-2026", expectedEndAt: T2)` as the final step of the reveal
- **THEN** `seasons.json#history` gains a new entry `{ slug: "august-2026", startedAt: T0, expectedEndAt: T1, endedAt: Date.now(), categories: <august's currentCategories> }`
- **AND** `seasons.json#current` is `"september-2026"`, `currentStartedAt` is `Date.now()`, `currentExpectedEndAt` is `T2`
- **AND** `seasons.json#currentCategories` equals `categories.json` (since no `themeExtras` was passed — a non-themed season)

#### Scenario: Themed rollover with themeExtras

- **GIVEN** `categories.json` contains 30 categories
- **WHEN** Claude calls `start_new_season(slug: "marine-biology-sept-2026", expectedEndAt: T2, themeExtras: ["Cephalopods", "Coral Reefs", "Tides"])`
- **THEN** `seasons.json#currentCategories` is `unique([...categories.json, "Cephalopods", "Coral Reefs", "Tides"])` — 33 entries (assuming no overlap)
- **AND** `categories.json` is unchanged

#### Scenario: Empty resulting pool is rejected

- **GIVEN** `categories.json` is empty (a corrupted or pristine deployment) and the caller passes no `themeExtras`
- **WHEN** `start_new_season(slug, expectedEndAt)` is called
- **THEN** the tool returns a structured error indicating the new season would have no categories
- **AND** `seasons.json` is unchanged

#### Scenario: Admin-triggered manual rollover mid-season

- **GIVEN** `seasons.json#current` is `"august-2026"` with `currentExpectedEndAt` corresponding to Aug 31
- **AND** today is Aug 14
- **WHEN** an admin says "start a new season" in any thread and Claude calls `start_new_season(slug: "autumn-arrival", expectedEndAt: <Sep 30 23:59>)`
- **THEN** the history entry for August preserves `expectedEndAt: <Aug 31 23:59>` and records `endedAt: <Aug 14 ...>`
- **AND** `current` becomes `"autumn-arrival"` with the new `expectedEndAt`

#### Scenario: Duplicate slug rejected

- **WHEN** `start_new_season` is called with a `slug` that matches `current` or any `history[].slug`
- **THEN** the tool returns a structured error indicating the slug is already in use
- **AND** `seasons.json` is unchanged

#### Scenario: expectedEndAt must be in the future

- **WHEN** `start_new_season` is called with `expectedEndAt <= Date.now()`
- **THEN** the tool returns a structured error indicating the expected end is not in the future
- **AND** `seasons.json` is unchanged

#### Scenario: Same-day duplicate call is a no-op

- **GIVEN** `start_new_season` was called once today and `seasons.json#currentStartedAt` is within the current calendar day in the reveal schedule's timezone
- **WHEN** `start_new_season` is called again the same day
- **THEN** the tool returns `{ noop: true, currentSlug, currentExpectedEndAt }`
- **AND** `seasons.json` is unchanged

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** `start_new_season` is absent from the session's MCP catalog

### Requirement: Season tag on new records

When `seasons.enabled` is `true`, the Trivia plugin SHALL stamp `season: <seasons.json#current>` onto every newly-written record in `questions.json`, `answers.json`, and `cheats.json`. The `season` value SHALL be captured by reading `seasons.json#current` at the moment of write, so a record stamped during season "august-2026" remains tagged with `"august-2026"` even after the season has rolled over.

`users.json` and `categories.json` SHALL NOT carry a `season` field — users and categories span seasons by design.

#### Scenario: save_question stamps season

- **GIVEN** `seasons.json#current` is `"august-2026"`
- **WHEN** `save_question` is called with valid arguments
- **THEN** the new entry in `questions.json` includes `season: "august-2026"` alongside the existing fields

#### Scenario: submit_answers stamps season on each answer

- **GIVEN** `seasons.json#current` is `"august-2026"`
- **WHEN** `submit_answers` records three new answer entries
- **THEN** each entry in `answers.json` includes `season: "august-2026"`

#### Scenario: save_cheating stamps season

- **GIVEN** `seasons.json#current` is `"august-2026"`
- **WHEN** `save_cheating` records a cheat
- **THEN** the entry in `cheats.json` includes `season: "august-2026"`

#### Scenario: Users and categories are not tagged

- **WHEN** any tool writes to `users.json` or `categories.json`
- **THEN** no `season` field is present on those records

#### Scenario: Disabled config skips tagging

- **GIVEN** `seasons.enabled` is `false`
- **WHEN** any tool writes to `questions.json`, `answers.json`, or `cheats.json`
- **THEN** no `season` field is present on the new records

### Requirement: Season-finale section in reveal flow

When `seasons.enabled` is `true` AND `check_season_status` returns `isLastFireOfSeason: true`, the reveal flow SHALL render an additional **season-finale section** above the leaderboard table. The finale section SHALL summarize the season that is closing — the season's slug, its dates, the season's MVP (highest `currentSeasonCorrect` per `retrieve_scores`), and a brief Game-Show-Presenter wrap-up paragraph in the persona's voice. The finale SHALL NOT include the new season's slug — the rollover is announced only after `start_new_season` is called as the reveal flow's final step.

When `isLastFireOfSeason` is `false`, no finale section is rendered.

When `seasons.enabled` is `false`, no finale section is rendered and `check_season_status` is not called.

#### Scenario: Mid-season reveal has no finale

- **GIVEN** `seasons.enabled` is `true` and `isLastFireOfSeason` is `false`
- **WHEN** the reveal flow completes
- **THEN** the posted reveal contains no "season finale" header, paragraph, or MVP callout

#### Scenario: Season-end reveal includes finale before leaderboard

- **GIVEN** `seasons.enabled` is `true` and `isLastFireOfSeason` is `true`
- **WHEN** the reveal flow completes
- **THEN** the posted reveal contains a section announcing the season closing
- **AND** the section names the closing season's slug
- **AND** the section names the season MVP (the player at index 0 of the current-season ranking from `retrieve_scores`)
- **AND** the section appears above the 3-row leaderboard table
- **AND** `start_new_season` is the final tool the reveal flow calls

#### Scenario: Seasons-off reveal has no finale logic

- **GIVEN** `seasons.enabled` is `false`
- **WHEN** the reveal flow completes
- **THEN** `check_season_status` is not invoked at any point in the flow
- **AND** no finale section is rendered

### Requirement: 3-row dual-totals leaderboard rendering

When `seasons.enabled` is `true`, the leaderboard `table` parameter passed to `submit_response` at reveal time SHALL be a 3-row table:

- **Row 1** — empty top-left cell, then one cell per player containing the player's `displayName` (NO medal prefix on this row).
- **Row 2** — left cell text `"Current Season"`, then one cell per player containing `currentSeasonCorrect` as a string, with medal prefix `🥇 `, `🥈 `, `🥉 ` (Unicode characters, not Slack shortcodes) on the player(s) holding the top-3 current-season scores.
- **Row 3** — left cell text `"All Time"`, then one cell per player containing `totalCorrect` as a string, with medal prefix `🥇 `, `🥈 `, `🥉 ` on the player(s) holding the top-3 all-time scores. The all-time medal assignment SHALL be independent of the current-season medal assignment — the same player MAY hold a medal on both rows, or different players MAY hold the top spots on each row.

Column order SHALL be by `currentSeasonCorrect` descending; ties SHALL be broken by `totalCorrect` descending.

Players who have not participated in the current season (i.e., `currentSeasonCorrect === 0` AND `currentSeasonAnswered === 0`) SHALL be omitted from the table to keep its column count bounded.

`column_settings` SHALL contain one entry per column with `{ "align": "center" }`. Where fewer than 3 players exist in the current season, the medals SHALL be assigned in order to whichever players exist (1 player → only 🥇, 2 players → 🥇 and 🥈).

When `seasons.enabled` is `false`, the leaderboard SHALL render as the prior 2-row form (names row + scores row) — this requirement applies only when seasons are enabled.

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
- **AND** `column_settings` has 4 entries each with `{ align: "center" }`

#### Scenario: Player with 0 current-season is omitted

- **GIVEN** Dave has `currentSeasonCorrect: 0`, `currentSeasonAnswered: 0`, `totalCorrect: 50`
- **WHEN** the reveal renders the leaderboard
- **THEN** Dave does NOT appear as a column
- **AND** the table's column count does not include Dave's all-time presence

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

### Requirement: First-enable backfill migration

The Trivia plugin SHALL ship a boot migration (priority `blocking`) that runs once when `trivia.seasons.enabled` is observed `true` and `seasons.json` does not yet exist. The migration SHALL:

1. Read `trivia.seasons.prompt` from config.
2. Generate (via Claude with the prompt as context, or via deterministic fallback if Claude is unavailable) an initial slug and an `expectedEndAt` consistent with the prompt and the current date.
3. Write `seasons.json` with `current: <initial-slug>`, `currentStartedAt: Date.now()`, `currentExpectedEndAt: <generated>`, `history: []`.
4. Rewrite `questions.json`, `answers.json`, `cheats.json` so every entry lacking a `season` field gains `season: <initial-slug>`. Entries that already have a `season` field SHALL be preserved unchanged.

The migration SHALL be idempotent — running it a second time (e.g., due to a restart loop) SHALL detect that `seasons.json` exists and exit without writes.

#### Scenario: First enable on existing deployment

- **GIVEN** a deployment with populated `questions.json`, `answers.json`, `cheats.json` and no `seasons.json`
- **WHEN** `trivia.seasons.enabled` is changed from `false` to `true` and the app boots
- **THEN** `seasons.json` is created with a non-empty `current` slug
- **AND** every entry in `questions.json`, `answers.json`, and `cheats.json` has a `season` field equal to `seasons.json#current`

#### Scenario: Idempotent re-run

- **GIVEN** the migration has already run once and `seasons.json` exists
- **WHEN** the app boots again
- **THEN** the migration detects `seasons.json` exists and exits without modifying any data file

#### Scenario: First enable on a fresh deployment

- **GIVEN** a deployment with empty `questions.json` / `answers.json` / `cheats.json` and no `seasons.json`
- **WHEN** `trivia.seasons.enabled` is `true` and the app boots
- **THEN** `seasons.json` is created with a non-empty `current` slug and empty `history`
- **AND** the three data files remain empty arrays

### Requirement: trivia-check instruction advertises manual season trigger

When `seasons.enabled` is `true`, the `trivia-check` instruction registered by the Trivia plugin SHALL include guidance directing admins that they can ask Clack to "start a new season" at any time, and that Claude SHOULD derive the new slug and `expectedEndAt` from `trivia.seasons.prompt` plus any explicit overrides the admin provides in natural language.

When `seasons.enabled` is `false`, the instruction SHALL NOT include this guidance (to avoid advertising a tool the session does not have).

#### Scenario: Instruction includes manual-trigger guidance when enabled

- **GIVEN** `seasons.enabled` is `true`
- **WHEN** a session loads the `trivia-check` instruction
- **THEN** the resolved instruction text references the ability for an admin to ask "start a new season"
- **AND** references `start_new_season` by name as the tool that will be called

#### Scenario: Instruction omits guidance when disabled

- **GIVEN** `seasons.enabled` is `false`
- **WHEN** a session loads the `trivia-check` instruction
- **THEN** the resolved instruction text does NOT reference `start_new_season` or manual season triggering
