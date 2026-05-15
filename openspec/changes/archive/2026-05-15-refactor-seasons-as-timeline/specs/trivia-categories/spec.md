## MODIFIED Requirements

### Requirement: Add categories tool

The system SHALL provide an `add_categories` MCP tool (dev+ role) that appends categories with deduplication.

The tool SHALL accept an optional `target` argument. With the seasons-as-timeline refactor, `target` accepts:

- `"current"` (default) — appends to the currently-active season's `categories` (per `findCurrentSeason(state, now)`). When no season is currently active (gap), this resolves to "no-op-with-warning" — Claude is informed there is no current season to mutate.
- `"default"` — appends to `categories.json` (the persistent baseline used when new seasons are created).
- `"both"` — appends to BOTH the active season AND `categories.json` (legacy alias).
- **Any other string** — interpreted as a season slug. Appends to that season's `categories` array. If the slug does not match any entry on the timeline, the tool returns a not-found error.

When `trivia.seasons.enabled` is `false`, the `target` argument is silently ignored and the tool operates on `categories.json` alone (legacy behavior).

Deduplication is applied independently per target.

#### Scenario: Add to a queued future season by slug

- **GIVEN** the timeline contains future "june-2026" with `categories: ["Marine Biology", "Coral Reefs"]`
- **WHEN** `add_categories(["Whales"], target: "june-2026")` is called
- **THEN** "Whales" is appended to "june-2026"'s `categories`
- **AND** no other season's `categories` is affected, and `categories.json` is unchanged

#### Scenario: Target is unknown slug

- **WHEN** `add_categories(["Foo"], target: "nonexistent-slug")` is called
- **THEN** the tool returns a not-found error for the slug
- **AND** no mutations occur

#### Scenario: target "current" during a gap is a warned no-op

- **GIVEN** `now` falls in a gap (no season's window contains it)
- **WHEN** `add_categories(["Foo"], target: "current")` is called
- **THEN** the tool returns a structured response indicating no current season to mutate
- **AND** `categories.json` is unchanged (target was "current", not "both")

### Requirement: Remove categories tool

The system SHALL provide a `remove_categories` MCP tool (dev+ role) that removes categories by exact match.

The tool SHALL accept an optional `target` argument with the same enum as `add_categories`: `"current"`, `"default"`, `"both"`, or any specific season slug.

The active-pool-empty guard applies: if a removal would empty the currently-active season's `categories` array (per `findCurrentSeason`), the tool SHALL return a structured error and SHALL NOT mutate any file. Removing the last category from a future-only or past-only season is permitted (those pools are not the read source for `get_ideas`/`save_question` right now).

Other behaviors (case-insensitive matching, per-target dispatch) are preserved.

#### Scenario: Remove from a queued future season by slug

- **GIVEN** the timeline contains future "june-2026" with `categories: ["Marine Biology", "Coral Reefs", "Tides"]`
- **WHEN** `remove_categories(["Tides"], target: "june-2026")` is called
- **THEN** "Tides" is removed from "june-2026"'s `categories`
- **AND** no other season's `categories` is affected

#### Scenario: Active-pool-empty guard still blocks emptying current season

- **GIVEN** the active season has `categories: ["Only Topic"]`
- **WHEN** `remove_categories(["Only Topic"], target: "current")` is called
- **THEN** the call is rejected with an active-pool-empty error

#### Scenario: Emptying a future season's categories is permitted

- **GIVEN** the timeline contains future "june-2026" with `categories: ["Coral Reefs"]`
- **WHEN** `remove_categories(["Coral Reefs"], target: "june-2026")` is called
- **THEN** the call... wait — actually this leaves june-2026 with zero categories, which violates the per-season non-empty invariant.

Actually the per-season "categories must be non-empty" invariant still applies — see the seasons-json schema requirement in `trivia-seasons`. So this call SHALL be rejected with a "season would have empty categories" error, distinct from the active-pool-empty guard. The distinction matters only for the error message (which guard triggered).

#### Scenario: Removing the last category of any season is rejected

- **WHEN** `remove_categories` would leave any single-targeted season with zero categories
- **THEN** the tool returns an error indicating the season would have no categories
- **AND** no file is mutated

### Requirement: Get ideas tool

The system SHALL provide a `get_ideas` MCP tool (member role) that returns category suggestions for the next trivia question alongside server-computed hints that bias the question's truth value and difficulty.

When `trivia.seasons.enabled` is `true`, the tool SHALL read its source pool from the currently-active season's `categories` (resolved via `findCurrentSeason(state, now)`). When seasons are disabled OR when there is no current season (gap), the tool SHALL read from `categories.json` (legacy / fallback behavior).

The exclusion window scaling (`min(10, floor(activePoolSize / 3))`) and the per-call `suggestedAnswer` / `suggestedDifficulty` distributions are unchanged.

#### Scenario: Get ideas reads the active season's pool

- **GIVEN** `trivia.seasons.enabled` is `true` and `findCurrentSeason(state, now)` returns an entry with `categories: ["Marine Biology", "Coral Reefs", ...]` (8 entries)
- **WHEN** `get_ideas` is called
- **THEN** `categories.ideas` is drawn only from that season's `categories`
- **AND** `categories.total` equals 8

#### Scenario: Get ideas falls back to categories.json during a gap

- **GIVEN** `trivia.seasons.enabled` is `true` but `findCurrentSeason(state, now)` returns `null`
- **WHEN** `get_ideas` is called
- **THEN** `categories.ideas` is drawn from `categories.json`

### Requirement: save_question validates category

The `save_question` tool SHALL reject questions whose category is not in the active source pool. When `trivia.seasons.enabled` is `true` AND `findCurrentSeason(state, now)` returns a season, the active source pool is that season's `categories`. Otherwise (seasons disabled or in a gap), the active source pool is `categories.json`.

The same case-insensitive matching and error-with-hint behavior is preserved.

#### Scenario: Valid category in active season's pool

- **GIVEN** the active season's `categories` contains "Marine Biology"
- **WHEN** `save_question` is called with `category: "Marine Biology"`
- **THEN** the question is saved

#### Scenario: Category in baseline but not active season is rejected

- **GIVEN** the active season's `categories` does NOT contain "Sports" but `categories.json` does
- **WHEN** `save_question` is called with `category: "Sports"`
- **THEN** the tool returns an error suggesting use of `add_categories` (with `target: "current"` if just for this season, or `"both"` to also persist)
