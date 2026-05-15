## MODIFIED Requirements

### Requirement: Add categories tool

The system SHALL provide an `add_categories` MCP tool (dev+ role) that appends categories with deduplication.

The tool SHALL accept an optional `target: "current" | "default" | "both"` argument controlling where the additions land:

- `"current"`: appends to `seasons.json#currentCategories` only.
- `"default"`: appends to `categories.json` only (the persistent baseline that future seasons seed from).
- `"both"` (default): appends to both `currentCategories` and `categories.json`.

When `trivia.seasons.enabled` is `false`, the `target` argument SHALL be silently ignored and the tool SHALL operate on `categories.json` alone (legacy behavior).

Deduplication SHALL be applied independently to each target — a category that already exists in `categories.json` but not in `currentCategories` is skipped for the former and added for the latter.

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

#### Scenario: Insufficient role

- **WHEN** a member-role user calls `add_categories`
- **THEN** the tool is not available (gated by SDK role system)

### Requirement: Remove categories tool

The system SHALL provide a `remove_categories` MCP tool (dev+ role) that removes categories by exact match.

The tool SHALL accept an optional `target: "current" | "default" | "both"` argument with the same semantics as `add_categories`:

- `"current"`: removes only from `seasons.json#currentCategories`.
- `"default"`: removes only from `categories.json`.
- `"both"` (default): removes from both.

When `trivia.seasons.enabled` is `false`, the `target` argument SHALL be silently ignored and the tool SHALL operate on `categories.json` alone.

If a target's pool becomes empty as a direct result of a `remove_categories` call AND that pool is the active read source for `get_ideas` (i.e. `target` is `"current"` or `"both"` and seasons are enabled, OR seasons are disabled), the tool SHALL return a structured error and SHALL NOT mutate the file — the active pool MUST always be non-empty.

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

When `trivia.seasons.enabled` is `true`, the tool SHALL read its source pool from `seasons.json#currentCategories`. When seasons are disabled, the tool SHALL read from `categories.json` (legacy behavior).

`categories.ideas` SHALL contain up to 5 random categories drawn from the active source pool, excluding categories used in the last `min(10, floor(activePoolSize / 3))` questions of the current season (or of all questions, when seasons are disabled). The exclusion window scales down for small themed pools so a season with 8 categories does not deadlock with an empty `ideas` array. `categories.total` SHALL be the total number of categories in the active source pool. `categories.excluded` SHALL be the count of recently-used categories filtered out.

`suggestedAnswer` and `suggestedDifficulty` distributions SHALL be unchanged from prior behavior (uniform boolean and 30/60/10 weighting respectively).

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

The `save_question` tool SHALL reject questions whose category is not in the active source pool. When `trivia.seasons.enabled` is `true`, the active source pool is `seasons.json#currentCategories`; when disabled, it is `categories.json`.

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
