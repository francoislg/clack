## MODIFIED Requirements

### Requirement: SeasonEntry and SeasonFormatSlot carry promptMedium cascade fields

`SeasonEntry` SHALL accept an optional `promptMedium?: Record<"text" | "image", number>` field alongside the existing `answersFormat` / `questionType` / `contexts` cascade fields. `SeasonFormatSlot` SHALL accept the same optional `promptMedium` field for per-slot override.

The cascade resolution order SHALL be `slot → season → config → default { text: 1, image: 0 }`, matching the established pattern for other axes. Mid-season mutation SHALL be permitted (same semantics as `answersFormat` and `questionType` — changes take effect on the next question-cron fire).

#### Scenario: Season-level promptMedium overrides config

- **GIVEN** `config.trivia.promptMedium: { text: 1, image: 0 }`
- **AND** the active season's `promptMedium: { text: 1, image: 2 }`
- **WHEN** `get_ideas` rolls many times during that season
- **THEN** roughly 2/3 of rolls yield `suggestedPromptMedium: "image"` (subject to weight semantics)

#### Scenario: Slot-level promptMedium overrides season

- **GIVEN** the active season's `promptMedium: { text: 1, image: 0 }`
- **AND** slot 1's `promptMedium: { text: 0, image: 1 }`
- **WHEN** `get_ideas({ slot: 1 })` is called
- **THEN** `suggestedPromptMedium` is always `"image"` (slot wins)

#### Scenario: Mid-season promptMedium mutation takes effect on next fire

- **GIVEN** an active season was created with `promptMedium: { text: 1, image: 0 }`
- **WHEN** an admin calls `upsert_season` to set `promptMedium: { text: 0, image: 1 }`
- **AND** the next question-cron fire runs
- **THEN** `get_ideas` for that fire returns `suggestedPromptMedium: "image"`

### Requirement: upsert_season accepts promptMedium argument

The `upsert_season` MCP tool SHALL accept optional `promptMedium` weights at both the season-entry level and (when `format` is provided) the per-slot level. The tool SHALL validate `promptMedium` the same way `config.trivia.promptMedium` is validated:

- Only keys `"text"` and `"image"` permitted.
- Non-negative integer weights.
- At least one positive weight (all-zero maps rejected).

#### Scenario: Upsert season with image-only promptMedium

- **WHEN** `upsert_season` is called with `promptMedium: { text: 0, image: 1 }`
- **THEN** the persisted season entry carries that promptMedium and subsequent `get_ideas` rolls for that season yield `suggestedPromptMedium: "image"`

#### Scenario: Upsert season with per-slot promptMedium

- **WHEN** `upsert_season` is called with a `format` containing slots whose `promptMedium` weights differ
- **THEN** each slot's `promptMedium` is persisted and applied independently on the next fire

#### Scenario: Invalid promptMedium rejected

- **WHEN** `upsert_season` is called with `promptMedium: { text: 0, image: 0 }`
- **THEN** the tool returns an error explaining that at least one positive weight is required
