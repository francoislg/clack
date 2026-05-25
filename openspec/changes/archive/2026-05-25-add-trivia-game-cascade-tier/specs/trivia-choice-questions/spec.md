## MODIFIED Requirements

### Requirement: answersFormat is per-season, with config fallback

`answersFormat` resolution at `get_ideas` time SHALL follow this priority (slot → season → per-game → workspace → built-in default):

1. If the seasons feature is enabled AND `findCurrentSeason(state, Date.now())` returns a non-null `SeasonEntry` whose `format` is present AND the resolved slot (per the call's `slot` argument, default `0`) has a `answersFormat` field set, use that slot's `answersFormat`.
2. Otherwise, if the seasons feature is enabled AND `findCurrentSeason` returns a non-null `SeasonEntry` whose `answersFormat` field is set, use that entry's `answersFormat`.
3. Otherwise, if the call's `game` argument resolves to a `TriviaGame` entry whose `answersFormat` field is set, use that entry's `answersFormat` (NEW per-game tier).
4. Otherwise (no slot, season, or per-game value), use `config.trivia.answersFormat` (workspace tier).
5. Otherwise (all sources absent), default to `{ "boolean": 1 }` (pure-boolean, equivalent to pre-change behavior).

The system SHALL re-read these sources on every `get_ideas` call — no caching, no pre-computation. The `choices.{min, max}` setting SHALL NOT be season-overridable, per-game-overridable, or slot-overridable — it lives only at `config.trivia.choices` with defaults `{ min: 2, max: 4 }`.

#### Scenario: Slot's answersFormat overrides season's

- **GIVEN** seasons are enabled and the active season has `answersFormat: { boolean: 1, choice: 1 }` and `format: { questions: [{ answersFormat: { choice: 1 } }, {}] }`
- **WHEN** `get_ideas` is called with `slot: 0`
- **THEN** the resolved `answersFormat` is `{ choice: 1 }` (slot 0 overrides)
- **AND** `suggestedAnswersFormat` is always `"choice"`

#### Scenario: Slot without answersFormat falls back to season's

- **GIVEN** seasons are enabled and the active season has `answersFormat: { boolean: 2, choice: 1 }` and `format: { questions: [{}, {}] }`
- **WHEN** `get_ideas` is called with `slot: 1`
- **THEN** the resolved `answersFormat` is the season's `{ boolean: 2, choice: 1 }`

#### Scenario: Current season's answersFormat overrides per-game and config (no format)

- **GIVEN** seasons are enabled and `findCurrentSeason(state, now)` returns an entry with `answersFormat: { "choice": 1 }` and no `format`
- **AND** `config.trivia.games[0].answersFormat` is `{ "boolean": 1 }`
- **AND** `config.trivia.answersFormat` is `{ "boolean": 1 }`
- **WHEN** `get_ideas` is called
- **THEN** the returned `suggestedAnswersFormat` is always `"choice"`

#### Scenario: Per-game answersFormat overrides workspace (no season override)

- **GIVEN** seasons are disabled OR no current season override applies
- **AND** `config.trivia.games[0].answersFormat` is `{ "choice": 1 }`
- **AND** `config.trivia.answersFormat` is `{ "boolean": 1 }`
- **WHEN** `get_ideas(game: "main")` is called
- **THEN** the returned `suggestedAnswersFormat` is always `"choice"` (per-game wins over workspace)

#### Scenario: Current season without answersFormat or format falls through per-game then to config

- **GIVEN** seasons are enabled and the current `SeasonEntry` has no `answersFormat` field and no `format` field
- **AND** `config.trivia.games[0]` has no `answersFormat` field
- **AND** `config.trivia.answersFormat` is `{ "boolean": 2, "choice": 1 }`
- **WHEN** `get_ideas(game: "main")` is called
- **THEN** the system uses `config.trivia.answersFormat` weights for the random roll (workspace tier)

#### Scenario: Timeline gap falls through per-game then to config

- **GIVEN** seasons are enabled but `findCurrentSeason(state, now)` returns `null` (now falls between seasons)
- **AND** `config.trivia.games[0]` has no `answersFormat` field
- **AND** `config.trivia.answersFormat` is `{ "boolean": 2, "choice": 1 }`
- **WHEN** `get_ideas(game: "main")` is called
- **THEN** the system uses `config.trivia.answersFormat` weights

#### Scenario: Seasons disabled with per-game override

- **GIVEN** seasons are disabled (`trivia.seasons.enabled: false` or absent)
- **AND** `config.trivia.games[0].answersFormat` is `{ "boolean": 1, "choice": 1 }`
- **AND** `config.trivia.answersFormat` is `{ "boolean": 1 }`
- **WHEN** `get_ideas(game: "main")` is called
- **THEN** the system uses the per-game `{ "boolean": 1, "choice": 1 }` weights (per-game beats workspace)

#### Scenario: Seasons disabled uses config when no per-game override

- **GIVEN** seasons are disabled
- **AND** `config.trivia.games[0]` has no `answersFormat` field
- **AND** `config.trivia.answersFormat` is `{ "boolean": 2, "choice": 1 }`
- **WHEN** `get_ideas(game: "main")` is called
- **THEN** the system uses `config.trivia.answersFormat` weights

#### Scenario: All sources absent defaults to boolean-only

- **GIVEN** no slot, season, per-game, or workspace `answersFormat` is set
- **WHEN** `get_ideas` is called
- **THEN** the returned `suggestedAnswersFormat` is always `"boolean"`

#### Scenario: Mid-season format update via upsert_season takes effect on next call

- **GIVEN** `get_ideas(slot: 0)` was called once with no format
- **WHEN** `upsert_season(currentSlug, { format: { questions: [{ answersFormat: { choice: 1 } }] } })` is called and `get_ideas(slot: 0)` is called again
- **THEN** the second call uses the new slot 0's `answersFormat` of `{ choice: 1 }`

#### Scenario: Mid-game update via upsert_game takes effect on next call

- **GIVEN** `get_ideas(game: "main")` was called once with no per-game override
- **WHEN** an admin approves an `upsert_game(game: "main", answersFormat: { "choice": 1 })` config update and `get_ideas(game: "main")` is called again
- **THEN** the second call observes the updated per-game `answersFormat` (subject to standard config-reload semantics)

#### Scenario: Mid-season update via upsert_season takes effect on next call

- **GIVEN** `get_ideas` was called once with the current entry's previous `answersFormat`
- **WHEN** `upsert_season(currentSlug, { answersFormat: { "choice": 1 } })` is called and `get_ideas` is called again
- **THEN** the second call uses the updated weights

#### Scenario: choices.min/max is not per-season, per-game, or per-slot

- **GIVEN** `config.trivia.choices` is `{ min: 2, max: 4 }`
- **AND** the active season has a `format` with slots that specify `answersFormat`
- **AND** the active game has a per-game `answersFormat` override
- **WHEN** `get_ideas` reads the choice bounds (for a choice-typed roll)
- **THEN** the system uses `config.trivia.choices` regardless of slot, season, or per-game overrides
