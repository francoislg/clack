## MODIFIED Requirements

### Requirement: Remove categories tool

The system SHALL provide a `remove_categories` MCP tool (dev+ role) that removes categories by exact match.

The tool SHALL accept an optional `target` argument with the same semantics as `add_categories`: `"current"` (default), `"default"`, `"both"`, or any specific season slug.

When `trivia.seasons.enabled` is `false`, the `target` argument SHALL be silently ignored and the tool SHALL operate on `categories.json` alone.

The `categories.json` (global) pool SHALL NOT be emptied. If a `"default"` or `"both"`-targeted removal would bring `categories.json` to zero entries, the tool SHALL return a structured error and SHALL NOT mutate any file. The global pool is the floor of the cascade — emptying it would leave inheritance-style seasons without any pool to resolve to.

When a removal targets the current season OR a specific season slug AND the removal would empty that season's `categories` array, the tool SHALL drop the `categories` field from that entry (rather than rejecting the call). The season then participates in the cascade (`slot → season → game → global`). The response SHALL signal the field-drop explicitly via a `cleared` marker so Claude can distinguish "removed last item, season inherits now" from "removed some items, season still has a pool".

The tool's response shape SHALL be (fields conditional on the target):

```
{
  removed: { default?: string[]; current?: string[]; [slug: string]?: string[] },
  notFound: { default?: string[]; current?: string[]; [slug: string]?: string[] },
  totals: { default?: number; current?: number | null; [slug: string]?: number },
  cleared?: { current?: true; [slug: string]?: true }
}
```

The `cleared` key SHALL appear if and only if at least one targeted season had its `categories` field dropped. `totals` for a cleared target SHALL be `0` (not omitted) so Claude can see the resulting state.

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

#### Scenario: Removing the last current-season category drops the field

- **GIVEN** `seasons.json` current entry has `categories: ["Only Topic"]` and seasons are enabled
- **WHEN** `remove_categories` is called with `["Only Topic"]` and `target: "current"`
- **THEN** the call succeeds
- **AND** the current season's entry no longer has a `categories` field on disk
- **AND** the response includes `cleared: { current: true }`
- **AND** subsequent reads resolve the pool via the cascade (game's `categories` if set, else `categories.json`)

#### Scenario: Removing the last slug-targeted category drops the field

- **GIVEN** the timeline contains a season "june-2026" with `categories: ["Marine Biology"]`
- **WHEN** `remove_categories` is called with `["Marine Biology"]` and `target: "june-2026"`
- **THEN** the call succeeds
- **AND** the "june-2026" entry no longer has a `categories` field on disk
- **AND** the response includes `cleared: { "june-2026": true }`

#### Scenario: Removing the last global category is rejected

- **GIVEN** `categories.json` contains exactly one entry "Last Topic"
- **WHEN** `remove_categories` is called with `["Last Topic"]` and `target: "default"` or `"both"`
- **THEN** the tool returns a structured error indicating the global pool cannot be emptied
- **AND** no file is mutated

#### Scenario: Seasons disabled — last global category removal still rejected

- **GIVEN** `trivia.seasons.enabled` is `false` and `categories.json` contains exactly one entry
- **WHEN** `remove_categories` is called with that entry
- **THEN** the tool returns a structured error indicating the active pool would become empty
- **AND** no file is mutated

#### Scenario: add_categories on a season with no categories field returns inheritance error

- **GIVEN** a season has no `categories` field (it inherits from the cascade)
- **WHEN** `add_categories` is called with `target: "<that-season-slug>"` (or `target: "current"` when that season is current)
- **THEN** the tool returns a structured error with a `code` indicating inheritance (e.g. `SEASON_INHERITS_CATEGORIES`), the resolved `source` tier (`"game" | "global"`), and remediation guidance directing the admin to call `upsert_season(slug, { categories: [...] })` to break inheritance before adding individual entries
- **AND** no file is mutated

### Requirement: Get ideas tool

The system SHALL provide a `get_ideas` MCP tool (member role) that returns category suggestions for the next trivia question alongside server-computed hints that bias the question's truth value, difficulty, answer format, source type (fact vs topical), and lens.

The tool SHALL accept an optional `slot: number` argument (default `0`).

The tool SHALL return an object with the following shape:

```
{
  format: { slotCount: number; slots: Array<{ index: number; label?: string; categories: string[] }> } | null,
  categories: { ideas: string[]; total: number; excluded: number; source: "slot" | "season" | "game" | "global" };
  suggestedAnswer?: boolean;
  suggestedDifficulty: "Easy" | "Medium" | "Hard";
  suggestedAnswersFormat: "boolean" | "choice";
  suggestedQuestionType: "fact" | "topical";
  suggestedChoiceCount?: number;
  suggestedCorrectIndex?: number;
  contextPriority?: string[];
  firstFireOfSeason: boolean;
  theme?: string;
  slot: number;
}
```

The `format` field SHALL be:

- `null` when the active season has no `format` field, OR when seasons are disabled, OR when `findCurrentSeason` returns `null`.
- A meta object describing the active season's format otherwise. `slotCount` is `format.questions.length`. `slots[i].label` is the slot's label (omitted when absent). `slots[i].categories` is the slot's **fully-resolved** category pool via the cascade `slot.categories → season.categories → game.categories → categories.json` — never an empty array.

The `format` meta SHALL be byte-stable across calls within the same season as long as the inputs to the cascade are unchanged.

The `slot` field in the response SHALL echo back the request's `slot` argument (default `0`) for unambiguous correlation when Claude is iterating through slots.

The tool SHALL validate `slot`:

- When the active season has a `format`, `slot` MUST be in `[0, format.questions.length)`. Out-of-range values are rejected with a "slot index out of range" error.
- When the active season has no `format`, `slot` MUST be `0` (or omitted). Any other value is rejected with a "season has no format" error.

`suggestedAnswer`, `suggestedDifficulty`, `suggestedAnswersFormat`, `suggestedChoiceCount` / `suggestedCorrectIndex`, `suggestedQuestionType`, and `contextPriority` SHALL all be rolled FRESHLY ON EVERY CALL. The tool SHALL NOT cache or pre-roll suggestions across slot indices.

`firstFireOfSeason` and `theme` SHALL be derived deterministically from persisted state on each call (no caching, no pre-rolling).

When the active season has a `format`, the tool SHALL read its source category pool from the **resolved** cascade for the requested slot: `slot.categories → season.categories → game.categories → categories.json`. When the active season has no `format`, the tool SHALL read from the cascade rooted at the season level: `season.categories → game.categories → categories.json`. When seasons are disabled OR `findCurrentSeason` returns `null` (gap), the tool SHALL read from `categories.json` (legacy / fallback behavior).

The `categories.source` field SHALL be `"slot"`, `"season"`, `"game"`, or `"global"` — the tier that the cascade resolver returned for this call. This surfaces inheritance state directly to Claude. When the active season has a `format`, `source` MAY be any of the four values. When the active season has no `format`, `source` is restricted to `"season" | "game" | "global"` (the slot tier is unreachable without a format).

`categories.ideas` SHALL contain up to 5 random categories drawn from the active source pool, excluding categories used in the last `min(10, floor(activePoolSize / 3))` questions. `categories.total` SHALL be the total number of categories in the active source pool. `categories.excluded` SHALL be the count of recently-used categories filtered out.

Categories themselves remain flat (`string[]`) — there is no per-category weight on this axis.

`suggestedAnswer` SHALL be sampled uniformly at random (50/50). `suggestedDifficulty` SHALL be sampled by weighted-random pick from the resolved `difficultyRatio` axis. `suggestedAnswersFormat` SHALL be sampled from the active `answersFormat` weights. `suggestedQuestionType` SHALL be sampled from the active `questionType` weights independently of `suggestedAnswersFormat`. `contextPriority`, when returned, SHALL be a weighted-random ordering of every configured context.

The 1–10 bucket-to-range mapping SHALL be returned as `suggestedDifficultyRange` per the active per-format `difficulty` cascade.

#### Scenario: Result shape with sufficient pool

- **WHEN** `get_ideas` is called, the pool has 50 categories, and the last 10 questions used categories A through J
- **THEN** the tool returns an object with `categories.ideas` containing 5 random categories, none of which are A through J
- **AND** `categories.total` equals 50
- **AND** `categories.excluded` equals 10
- **AND** `categories.source` is one of `"slot" | "season" | "game" | "global"`
- **AND** `suggestedAnswer` (when boolean) is a boolean
- **AND** `suggestedDifficulty` is one of `"Easy"`, `"Medium"`, or `"Hard"`
- **AND** `suggestedAnswersFormat` is one of `"boolean"` or `"choice"`
- **AND** `suggestedQuestionType` is one of `"fact"` or `"topical"`
- **AND** `firstFireOfSeason` is a boolean

#### Scenario: Get ideas reads season's pool when seasons are enabled and season has categories

- **GIVEN** `trivia.seasons.enabled` is `true`, the active season has `categories: ["A", "B", "C", "D", "E", "F", "G", "H"]`, the game has unrelated `categories: ["X", "Y"]`, and `categories.json` has 30 unrelated entries
- **WHEN** `get_ideas` is called
- **THEN** `categories.ideas` is drawn only from the season's 8 entries
- **AND** `categories.total` equals 8
- **AND** `categories.source` equals `"season"`

#### Scenario: Get ideas inherits from game when season has no categories

- **GIVEN** the active season has no `categories` field, the game has `categories: ["Music", "Sports", "Film"]`, and `categories.json` has 50 entries
- **WHEN** `get_ideas` is called
- **THEN** `categories.ideas` is drawn from the game's 3 entries
- **AND** `categories.total` equals 3
- **AND** `categories.source` equals `"game"`

#### Scenario: Get ideas inherits from global when neither season nor game set categories

- **GIVEN** the active season has no `categories` field, the game has no `categories` field, and `categories.json` has 50 entries
- **WHEN** `get_ideas` is called
- **THEN** `categories.ideas` is drawn from `categories.json`
- **AND** `categories.total` equals 50
- **AND** `categories.source` equals `"global"`

#### Scenario: Pool smaller than exclusion window

- **WHEN** `get_ideas` is called and fewer than 5 categories remain after exclusions
- **THEN** `categories.ideas` contains all remaining eligible categories (fewer than 5)
- **AND** `suggestedAnswer`, `suggestedDifficulty`, `suggestedAnswersFormat`, and `suggestedQuestionType` are still populated

#### Scenario: suggestedAnswer is sampled uniformly

- **WHEN** `get_ideas` is invoked many times with `suggestedAnswersFormat: "boolean"` resolved
- **THEN** each invocation independently produces `suggestedAnswer = true` with probability 0.5 and `suggestedAnswer = false` with probability 0.5

#### Scenario: Exclusion window scales for small pools

- **GIVEN** the resolved active source pool has 8 entries and 8 questions have already been asked in the current season
- **WHEN** `get_ideas` is called
- **THEN** `categories.excluded` equals `min(10, floor(8 / 3))` = 2 (not 8)
- **AND** `categories.ideas` is non-empty (at least one eligible category remains)

#### Scenario: Get ideas falls back to categories.json when seasons are disabled

- **GIVEN** `trivia.seasons.enabled` is `false`
- **WHEN** `get_ideas` is called
- **THEN** `categories.ideas` is drawn from `categories.json`
- **AND** `categories.source` equals `"global"`
- **AND** `format` is `null`
- **AND** `firstFireOfSeason` is `false`
- **AND** the response carries no `theme` field

#### Scenario: Format meta returned when season has format with slot inheriting from game

- **GIVEN** the active season has `format: { questions: [{ label: "GK 1" }, { label: "History Choice", categories: ["History", "Ancient Civilizations"] }] }`
- **AND** the season has no `categories` field
- **AND** the game has `categories: ["Science", "History", "Geography", "Ancient Civilizations"]`
- **WHEN** `get_ideas` is called with no `slot` argument
- **THEN** the response's `format` field is `{ slotCount: 2, slots: [{ index: 0, label: "GK 1", categories: ["Science", "History", "Geography", "Ancient Civilizations"] }, { index: 1, label: "History Choice", categories: ["History", "Ancient Civilizations"] }] }`
- **AND** slot 0's pool comes from the game (cascade fell through `slot → season → game`)
- **AND** slot 1's pool comes from its explicit override

#### Scenario: Slot argument routes to slot's resolved pool

- **GIVEN** the active season has the format from the prior scenario
- **WHEN** `get_ideas` is called with `slot: 1`
- **THEN** `categories.ideas` is drawn from slot 1's resolved pool (`["History", "Ancient Civilizations"]`)
- **AND** `categories.total` equals 2
- **AND** `categories.source` equals `"slot"`
- **AND** `slot` in the response equals `1`

#### Scenario: Each call rolls fresh suggestions

- **GIVEN** the active season has a 3-slot format
- **WHEN** `get_ideas` is called three times with `slot: 0`, then `slot: 1`, then `slot: 2`
- **THEN** each call independently rolls `suggestedAnswer`, `suggestedDifficulty`, `suggestedAnswersFormat`, `suggestedQuestionType`, and (when applicable) `contextPriority`
- **AND** prior call results are not cached or reused

#### Scenario: Out-of-range slot rejected

- **GIVEN** the active season has a 2-slot format
- **WHEN** `get_ideas` is called with `slot: 2`
- **THEN** the tool returns a structured "slot index out of range" error

#### Scenario: Non-zero slot rejected when no format

- **GIVEN** the active season has no `format`
- **WHEN** `get_ideas` is called with `slot: 1`
- **THEN** the tool returns a structured "season has no format" error

#### Scenario: Format meta omitted in a timeline gap

- **GIVEN** `trivia.seasons.enabled` is `true` but `findCurrentSeason` returns `null` (gap)
- **WHEN** `get_ideas` is called
- **THEN** `format` in the response is `null`
- **AND** `categories.ideas` is drawn from `categories.json` (fallback)
- **AND** `categories.source` equals `"global"`

#### Scenario: contextPriority omitted when contexts not configured

- **GIVEN** no `contexts` is set at any cascade tier
- **WHEN** `get_ideas` is called
- **THEN** the response does not include a `contextPriority` field

#### Scenario: firstFireOfSeason is true when no questions are stamped to the current slug

- **GIVEN** `trivia.seasons.enabled` is `true`, the current season is `"november-2026"`, and `games/main/questions.json` has zero entries with `season: "november-2026"`
- **WHEN** `get_ideas(game: "main")` is called
- **THEN** the response carries `firstFireOfSeason: true`

#### Scenario: theme is mirrored verbatim from the current season

- **GIVEN** the current season has `theme: "Halloween Spooktacular"`
- **WHEN** `get_ideas(game: "main")` is called
- **THEN** the response carries `theme: "Halloween Spooktacular"`

#### Scenario: theme is omitted when the current season has no theme set

- **GIVEN** the current season has no `theme` field
- **WHEN** `get_ideas(game: "main")` is called
- **THEN** the response object has no `theme` key at all (NOT `theme: null`, NOT `theme: ""`)

### Requirement: save_question validates category

The `save_question` tool SHALL reject questions whose category is not in the active source pool. The active source pool is resolved via the cascade `slot.categories → season.categories → game.categories → categories.json` — the same resolver used by `get_ideas` (`resolveActiveCategories` in `src/plugins/trivia/domain/categories.ts`).

When the call carries no `slot` (no active format), the cascade is rooted at the season level. When the call carries a `slot.index`, the cascade is rooted at that slot. When `trivia.seasons.enabled` is `false` OR `findCurrentSeason(state, now)` returns `null` (gap), the active source pool is `categories.json`.

The error returned on a rejected category SHALL conform to the schema:

```
{
  code: "CATEGORY_NOT_IN_POOL",
  source: "slot" | "season" | "game" | "global",
  categories: string[]
}
```

`source` is the cascade tier the resolver returned. `categories` is the full resolved pool from that tier. The identical schema applies to the `save_question slot binding` path defined in the `trivia-seasons` capability — there is one error shape for category-not-in-pool failures across both code paths.

#### Scenario: Valid category (season-tier pool)

- **GIVEN** seasons are enabled and the active season's `categories` contains "Marine Biology"
- **WHEN** `save_question` is called with `category: "Marine Biology"`
- **THEN** the question is saved

#### Scenario: Category in baseline but not current season is rejected

- **GIVEN** seasons are enabled, the active season has `categories: ["History"]`, and `categories.json` contains "Sports"
- **WHEN** `save_question` is called with `category: "Sports"`
- **THEN** the tool returns a structured `CATEGORY_NOT_IN_POOL` error
- **AND** the error payload identifies `source: "season"` and lists `["History"]`

#### Scenario: Valid category inherited from game

- **GIVEN** seasons are enabled, the active season has no `categories` field, and the game has `categories: ["Music", "Sports"]`
- **WHEN** `save_question` is called with `category: "Music"`
- **THEN** the question is saved

#### Scenario: Invalid category when season inherits from game

- **GIVEN** seasons are enabled, the active season has no `categories` field, and the game has `categories: ["Music", "Sports"]`
- **WHEN** `save_question` is called with `category: "History"`
- **THEN** the tool returns a structured `CATEGORY_NOT_IN_POOL` error
- **AND** the error payload identifies `source: "game"` and lists `["Music", "Sports"]`

#### Scenario: Valid category inherited from global

- **GIVEN** seasons are enabled, neither the season nor the game has a `categories` field, and `categories.json` contains "History"
- **WHEN** `save_question` is called with `category: "History"`
- **THEN** the question is saved

#### Scenario: Invalid category (seasons disabled)

- **GIVEN** seasons are disabled
- **WHEN** `save_question` is called with `category: "Unknown Topic"` and it does not exist in `categories.json`
- **THEN** the tool returns a structured `CATEGORY_NOT_IN_POOL` error
- **AND** the error payload identifies `source: "global"`
