# Trivia Categories

## Purpose

Management of the trivia question category pool, including seeding, administration, and discovery tools.

## Requirements

### Requirement: Category pool seeding

The system SHALL seed `categories.json` with 50 hardcoded categories on first plugin load when the file is missing or empty.

#### Scenario: First load with no categories file

- **WHEN** the trivia plugin loads and `categories.json` does not exist
- **THEN** the system creates `categories.json` with 50 unique categories

#### Scenario: First load with empty categories file

- **WHEN** the trivia plugin loads and `categories.json` exists but is an empty array
- **THEN** the system populates it with 50 unique categories

#### Scenario: Subsequent load with existing categories

- **WHEN** the trivia plugin loads and `categories.json` contains categories
- **THEN** the system does not modify the file

### Requirement: Add categories tool

The system SHALL provide an `add_categories` MCP tool (dev+ role) that appends categories with deduplication.

The tool SHALL accept an optional `target` argument (string) controlling where the additions land:

- `"current"`: appends to the currently-active season's `categories` array (resolved via `findCurrentSeason(state, now)`). When `now` falls in a timeline gap, this resolves to a warned no-op — Claude is informed there is no current season to mutate.
- `"default"`: appends to `categories.json` only (the persistent baseline that future seasons seed from).
- `"both"` (default): appends to BOTH the currently-active season AND `categories.json`.
- **Any other string**: interpreted as a season slug. Appends to that season's `categories` array. If the slug does not match any entry on the timeline, the tool returns a not-found error.

When `trivia.seasons.enabled` is `false`, the `target` argument SHALL be silently ignored and the tool SHALL operate on `categories.json` alone (legacy behavior).

Deduplication SHALL be applied independently per target.

#### Scenario: Add new categories (default target)

- **WHEN** `add_categories` is called with `["Quantum Physics", "Origami"]`, seasons are enabled, and neither category exists in either pool
- **THEN** both categories are appended to `categories.json`
- **AND** both categories are appended to `seasons.json#currentCategories`

#### Scenario: Add to current season only

- **WHEN** `add_categories` is called with `["Cephalopods"]` and `target: "current"`, seasons are enabled
- **THEN** "Cephalopods" is appended to `seasons.json#currentCategories`
- **AND** `categories.json` is unchanged

#### Scenario: Add to default baseline only

- **WHEN** `add_categories` is called with `["Future Topic"]` and `target: "default"`, seasons are enabled
- **THEN** "Future Topic" is appended to `categories.json`
- **AND** `seasons.json#currentCategories` is unchanged (the current season does NOT gain the new category)

#### Scenario: Add duplicate category

- **WHEN** `add_categories` is called with `["Science"]` (default target) and "Science" already exists in both pools
- **THEN** the duplicate is skipped for both
- **AND** the result indicates each was already present

#### Scenario: Seasons disabled — target argument ignored

- **GIVEN** `trivia.seasons.enabled` is `false`
- **WHEN** `add_categories` is called with `["Foo"]` and any `target` value
- **THEN** "Foo" is appended to `categories.json`
- **AND** no other side effects occur

#### Scenario: Add to a queued future season by slug

- **GIVEN** the timeline contains a future season "june-2026" with `categories: ["Marine Biology", "Coral Reefs"]`
- **WHEN** `add_categories(["Whales"], target: "june-2026")` is called
- **THEN** "Whales" is appended to "june-2026"'s `categories`
- **AND** no other season's `categories` and `categories.json` are unchanged

#### Scenario: Target slug not found returns an error

- **WHEN** `add_categories(["Foo"], target: "nonexistent-slug")` is called
- **THEN** the tool returns a not-found error
- **AND** no file is mutated

#### Scenario: target "current" during a gap is a warned no-op

- **GIVEN** `now` falls in a gap (no season's window contains it)
- **WHEN** `add_categories(["Foo"], target: "current")` is called
- **THEN** the tool returns a structured response indicating no current season to mutate
- **AND** no file is mutated

#### Scenario: Insufficient role

- **WHEN** a member-role user calls `add_categories`
- **THEN** the tool is not available (gated by SDK role system)

### Requirement: Remove categories tool

The system SHALL provide a `remove_categories` MCP tool (dev+ role) that removes categories by exact match.

The tool SHALL accept an optional `target` argument with the same semantics as `add_categories`: `"current"` (default), `"default"`, `"both"`, or any specific season slug.

When `trivia.seasons.enabled` is `false`, the `target` argument SHALL be silently ignored and the tool SHALL operate on `categories.json` alone.

The active-pool-empty guard applies: if a removal would empty the currently-active season's `categories` array (per `findCurrentSeason`), the tool SHALL return a structured error and SHALL NOT mutate any file. Additionally, every season's `categories` array MUST remain non-empty — removing the last category from a specifically-targeted past or future season is rejected with a "season would have zero categories" error.

#### Scenario: Remove existing category (default target)

- **WHEN** `remove_categories` is called with `["Sports"]`, seasons are enabled, and "Sports" exists in both pools
- **THEN** "Sports" is removed from `categories.json`
- **AND** "Sports" is removed from `seasons.json#currentCategories`

#### Scenario: Remove from current season only (keep in baseline)

- **WHEN** `remove_categories` is called with `["Sports"]` and `target: "current"`
- **THEN** "Sports" is removed from `seasons.json#currentCategories`
- **AND** `categories.json` is unchanged — the next season will still include "Sports" in its seed

#### Scenario: Remove non-existent category

- **WHEN** `remove_categories` is called with `["Nonexistent"]`
- **THEN** the tool succeeds with a result indicating the category was not found in either target

#### Scenario: Removing the last current category is rejected

- **GIVEN** `seasons.json#currentCategories` contains exactly one entry "Only Topic" and seasons are enabled
- **WHEN** `remove_categories` is called with `["Only Topic"]` and `target` `"current"` or `"both"`
- **THEN** the tool returns a structured error indicating the active pool would become empty
- **AND** no file is mutated

### Requirement: Get ideas tool

The system SHALL provide a `get_ideas` MCP tool (member role) that returns category suggestions for the next trivia question alongside server-computed hints that bias the question's truth value and difficulty.

The tool SHALL return an object with the following shape:

```
{
  categories: { ideas: string[]; total: number; excluded: number };
  suggestedAnswer: boolean;
  suggestedDifficulty: "Easy" | "Medium" | "Hard";
}
```

When `trivia.seasons.enabled` is `true` AND `findCurrentSeason(state, now)` returns a season, the tool SHALL read its source pool from that season's `categories`. When seasons are disabled OR `findCurrentSeason` returns `null` (gap), the tool SHALL read from `categories.json` (legacy / fallback behavior).

`categories.ideas` SHALL contain up to 5 random categories drawn from the active source pool, excluding categories used in the last `min(10, floor(activePoolSize / 3))` questions. The exclusion window scales down for small themed pools so a season with only 8 categories does not deadlock with an empty `ideas` array. `categories.total` SHALL be the total number of categories in the active source pool. `categories.excluded` SHALL be the count of recently-used categories filtered out.

`suggestedAnswer` SHALL be sampled uniformly at random — each call has a 50% chance of `true` and a 50% chance of `false`.

`suggestedDifficulty` SHALL be sampled with the following weights: 30% `"Easy"`, 60% `"Medium"`, 10% `"Hard"`. The bucket names map onto the 1–10 self-rating scale used downstream as follows:

| Bucket | 1–10 range (inclusive) |
| ------ | ---------------------- |
| Easy   | 4–6                    |
| Medium | 7–8                    |
| Hard   | 9–10                   |

The mapping itself is not part of the tool's payload; consumers (the trivia question-flow prompt) are responsible for translating the bucket name into the target 1–10 range.

#### Scenario: Result shape with sufficient pool

- **WHEN** `get_ideas` is called, the pool has 50 categories, and the last 10 questions used categories A through J
- **THEN** the tool returns an object with `categories.ideas` containing 5 random categories, none of which are A through J
- **AND** `categories.total` equals 50
- **AND** `categories.excluded` equals 10
- **AND** `suggestedAnswer` is a boolean
- **AND** `suggestedDifficulty` is one of `"Easy"`, `"Medium"`, or `"Hard"`

#### Scenario: Pool smaller than exclusion window

- **WHEN** `get_ideas` is called and fewer than 5 categories remain after exclusions
- **THEN** `categories.ideas` contains all remaining eligible categories (fewer than 5)
- **AND** `suggestedAnswer` and `suggestedDifficulty` are still populated

#### Scenario: suggestedAnswer is sampled uniformly

- **WHEN** `get_ideas` is invoked many times
- **THEN** each invocation independently produces `suggestedAnswer = true` with probability 0.5 and `suggestedAnswer = false` with probability 0.5
- **AND** the value is not derived from the date, channel, or any deterministic input

#### Scenario: suggestedDifficulty is weighted 30/60/10

- **WHEN** `get_ideas` is invoked many times
- **THEN** each invocation independently produces `suggestedDifficulty = "Easy"` with probability 0.30, `"Medium"` with probability 0.60, and `"Hard"` with probability 0.10

#### Scenario: Get ideas reads current season's pool when seasons are enabled

- **GIVEN** `trivia.seasons.enabled` is `true`, `seasons.json#currentCategories` has 8 entries, `categories.json` has 30 unrelated entries
- **WHEN** `get_ideas` is called
- **THEN** `categories.ideas` is drawn only from `currentCategories`
- **AND** `categories.total` equals 8

#### Scenario: Exclusion window scales for small pools

- **GIVEN** `seasons.json#currentCategories` has 8 entries and 8 questions have already been asked in the current season
- **WHEN** `get_ideas` is called
- **THEN** `categories.excluded` equals `min(10, floor(8 / 3))` = 2 (not 8)
- **AND** `categories.ideas` is non-empty (at least one eligible category remains)

#### Scenario: Get ideas falls back to categories.json when seasons are disabled

- **GIVEN** `trivia.seasons.enabled` is `false`
- **WHEN** `get_ideas` is called
- **THEN** `categories.ideas` is drawn from `categories.json`
- **AND** the behavior is identical to the pre-seasons implementation

### Requirement: save_question validates category

The `save_question` tool SHALL reject questions whose category is not in the active source pool. When `trivia.seasons.enabled` is `true` AND `findCurrentSeason(state, now)` returns a season, the active source pool is that season's `categories`. Otherwise (seasons disabled or in a gap), the active source pool is `categories.json`.

#### Scenario: Valid category (seasons enabled)

- **GIVEN** seasons are enabled and `seasons.json#currentCategories` contains "Marine Biology"
- **WHEN** `save_question` is called with `category: "Marine Biology"`
- **THEN** the question is saved

#### Scenario: Category in baseline but not current season is rejected

- **GIVEN** seasons are enabled, `categories.json` contains "Sports", and `seasons.json#currentCategories` does NOT contain "Sports"
- **WHEN** `save_question` is called with `category: "Sports"`
- **THEN** the tool returns an error suggesting the use of `add_categories` (with `target: "current"` if the admin wants it just for this season)

#### Scenario: Invalid category (seasons disabled)

- **GIVEN** seasons are disabled
- **WHEN** `save_question` is called with `category: "Unknown Topic"` and it does not exist in `categories.json`
- **THEN** the tool returns an error suggesting the use of `add_categories`
