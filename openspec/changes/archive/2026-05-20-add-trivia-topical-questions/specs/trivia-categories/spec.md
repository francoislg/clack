## MODIFIED Requirements

### Requirement: Get ideas tool

The system SHALL provide a `get_ideas` MCP tool (member role) that returns category suggestions for the next trivia question alongside server-computed hints that bias the question's truth value, difficulty, answer format, source type (fact vs topical), and lens.

The tool SHALL accept an optional `slot: number` argument (default `0`).

The tool SHALL return an object with the following shape:

```
{
  format: { slotCount: number; slots: Array<{ index: number; label?: string; categories: string[] }> } | null,
  categories: { ideas: string[]; total: number; excluded: number };
  suggestedAnswer?: boolean;                    // only when suggestedAnswersFormat === "boolean"
  suggestedDifficulty: "Easy" | "Medium" | "Hard";
  suggestedAnswersFormat: "boolean" | "choice"; // renamed from suggestedType
  suggestedQuestionType: "fact" | "topical";    // new — independent roll
  suggestedChoiceCount?: number;                // only when suggestedAnswersFormat === "choice"
  suggestedCorrectIndex?: number;               // only when suggestedAnswersFormat === "choice"
  contextPriority?: string[];                   // only when contexts configured at any cascade tier
  slot: number;
}
```

The `format` field SHALL be:

- `null` when the active season has no `format` field, OR when seasons are disabled, OR when `findCurrentSeason` returns `null`.
- A meta object describing the active season's format otherwise. `slotCount` is `format.questions.length`. `slots[i].label` is the slot's label (omitted when absent). `slots[i].categories` is the slot's _resolved_ category pool (slot.categories ?? season.categories).

The `format` meta SHALL be byte-stable across calls within the same season as long as the season's `format` field is unchanged — its contents do not depend on the `slot` argument or any randomness.

The `slot` field in the response SHALL echo back the request's `slot` argument (default `0`) for unambiguous correlation when Claude is iterating through slots.

The tool SHALL validate `slot`:

- When the active season has a `format`, `slot` MUST be in `[0, format.questions.length)`. Out-of-range values are rejected with a "slot index out of range" error.
- When the active season has no `format`, `slot` MUST be `0` (or omitted). Any other value is rejected with a "season has no format" error.

`suggestedAnswer`, `suggestedDifficulty`, `suggestedAnswersFormat` (per `trivia-choice-questions`), `suggestedChoiceCount` / `suggestedCorrectIndex` (per `trivia-choice-questions`), `suggestedQuestionType` (per `trivia-topical-questions`), and `contextPriority` (per `trivia-question-contexts`) SHALL all be rolled FRESHLY ON EVERY CALL. The tool SHALL NOT cache or pre-roll suggestions across slot indices.

When the active season has a `format`, the tool SHALL read its source category pool from the slot's resolved pool (`slot.categories ?? season.categories`). When the active season has no `format`, the tool SHALL read from the season's `categories`. When seasons are disabled OR `findCurrentSeason` returns `null` (gap), the tool SHALL read from `categories.json` (legacy / fallback behavior).

`categories.ideas` SHALL contain up to 5 random categories drawn from the active source pool, excluding categories used in the last `min(10, floor(activePoolSize / 3))` questions. The exclusion window scales down for small themed pools so a slot with only 8 categories does not deadlock with an empty `ideas` array. `categories.total` SHALL be the total number of categories in the active source pool. `categories.excluded` SHALL be the count of recently-used categories filtered out.

Categories themselves remain flat (`string[]`) — there is no per-category weight on this axis. Bias toward a particular thematic angle is expressed via the `contexts` axis (per `trivia-question-contexts`), not via category weights.

`suggestedAnswer` SHALL be sampled uniformly at random (50/50). `suggestedDifficulty` SHALL be sampled at weights 30% Easy / 60% Medium / 10% Hard. `suggestedAnswersFormat` SHALL be sampled from the active `answersFormat` weights. `suggestedQuestionType` SHALL be sampled from the active `questionType` weights independently of `suggestedAnswersFormat`. `contextPriority`, when returned, SHALL be a weighted-random ordering of every configured context (see `trivia-question-contexts`).

The 1–10 difficulty bucket mapping (Easy 4–6, Medium 7–8, Hard 9–10) is unchanged from prior behavior.

#### Scenario: Result shape with sufficient pool

- **WHEN** `get_ideas` is called, the pool has 50 categories, and the last 10 questions used categories A through J
- **THEN** the tool returns an object with `categories.ideas` containing 5 random categories, none of which are A through J
- **AND** `categories.total` equals 50
- **AND** `categories.excluded` equals 10
- **AND** `suggestedAnswer` (when boolean) is a boolean
- **AND** `suggestedDifficulty` is one of `"Easy"`, `"Medium"`, or `"Hard"`
- **AND** `suggestedAnswersFormat` is one of `"boolean"` or `"choice"`
- **AND** `suggestedQuestionType` is one of `"fact"` or `"topical"`

#### Scenario: Pool smaller than exclusion window

- **WHEN** `get_ideas` is called and fewer than 5 categories remain after exclusions
- **THEN** `categories.ideas` contains all remaining eligible categories (fewer than 5)
- **AND** `suggestedAnswer`, `suggestedDifficulty`, `suggestedAnswersFormat`, and `suggestedQuestionType` are still populated

#### Scenario: suggestedAnswer is sampled uniformly

- **WHEN** `get_ideas` is invoked many times with `suggestedAnswersFormat: "boolean"` resolved
- **THEN** each invocation independently produces `suggestedAnswer = true` with probability 0.5 and `suggestedAnswer = false` with probability 0.5

#### Scenario: suggestedDifficulty is weighted 30/60/10

- **WHEN** `get_ideas` is invoked many times
- **THEN** each invocation independently produces `suggestedDifficulty = "Easy"` with probability 0.30, `"Medium"` with probability 0.60, and `"Hard"` with probability 0.10

#### Scenario: suggestedQuestionType is independent of suggestedAnswersFormat

- **GIVEN** `answersFormat: { boolean: 1, choice: 1 }` and `questionType: { fact: 1, topical: 1 }`
- **WHEN** `get_ideas` is invoked many times
- **THEN** the joint distribution across `(suggestedAnswersFormat, suggestedQuestionType)` pairs approximates 25%/25%/25%/25% (within statistical tolerance)

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
- **AND** `format` is `null`
- **AND** the behavior is identical to the pre-seasons implementation aside from the additional `suggestedQuestionType` field (which defaults to `"fact"` when no `questionType` weights are configured)

#### Scenario: Format meta returned when season has format

- **GIVEN** the active season has `format: { questions: [{ label: "GK 1" }, { label: "History Choice", categories: ["History", "Ancient Civilizations"] }] }`
- **AND** the season's `categories` is `["Science", "History", "Geography", "Ancient Civilizations"]`
- **WHEN** `get_ideas` is called with no `slot` argument
- **THEN** the response's `format` field is `{ slotCount: 2, slots: [{ index: 0, label: "GK 1", categories: ["Science", "History", "Geography", "Ancient Civilizations"] }, { index: 1, label: "History Choice", categories: ["History", "Ancient Civilizations"] }] }`
- **AND** `slot` in the response equals `0`
- **AND** `categories.ideas` is drawn from slot 0's resolved pool (the season's full `categories`)

#### Scenario: Slot argument routes to slot's resolved pool

- **GIVEN** the active season has the format from the prior scenario
- **WHEN** `get_ideas` is called with `slot: 1`
- **THEN** `categories.ideas` is drawn from slot 1's resolved pool (`["History", "Ancient Civilizations"]`)
- **AND** `categories.total` equals 2
- **AND** `slot` in the response equals `1`
- **AND** `format` is identical to the prior call's `format` meta

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

#### Scenario: contextPriority omitted when contexts not configured

- **GIVEN** no `contexts` is set at any cascade tier
- **WHEN** `get_ideas` is called
- **THEN** the response does not include a `contextPriority` field

#### Scenario: contextPriority included when contexts configured

- **GIVEN** `config.trivia.contexts` is `[{ name: "Quebec" }, { name: "International" }]`
- **WHEN** `get_ideas` is called
- **THEN** the response includes `contextPriority` of length 2 — a permutation of `["Quebec", "International"]`
