## ADDED Requirements

### Requirement: Per-season and per-slot `revealResponses` accept `"just-winners"`

The optional `revealResponses` field on `SeasonEntry` and on each slot entry within `SeasonFormat.questions[]` SHALL accept `"just-winners"` in addition to `"no"`, `"just-correctness"`, and `"yes"`. These values participate in the existing `slot → season → game → workspace → "yes"` cascade resolved at `post_questions` time. The `upsert_season` tool SHALL validate and persist the value, and `list_seasons` SHALL surface per-season and per-slot `"just-winners"` when set.

#### Scenario: Season-level just-winners resolves through the cascade

- **GIVEN** a season entry with `revealResponses: "just-winners"`, no slot override, game default absent, workspace default `"yes"`
- **WHEN** `post_questions` stamps a question for that season
- **THEN** the stamped value is `"just-winners"`

#### Scenario: list_seasons surfaces a just-winners slot override

- **GIVEN** a `SeasonFormat.questions[i]` slot with `revealResponses: "just-winners"`
- **WHEN** an admin calls `list_seasons`
- **THEN** the output reports `revealResponses: "just-winners"` for that slot
