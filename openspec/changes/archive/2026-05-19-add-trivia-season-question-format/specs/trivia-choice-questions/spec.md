## MODIFIED Requirements

### Requirement: questionTypes is per-season, with config fallback

`questionsTypes` resolution at `get_ideas` time SHALL follow this priority:

1. If the seasons feature is enabled AND `findCurrentSeason(state, Date.now())` returns a non-null `SeasonEntry` whose `format` is present AND the resolved slot (per the call's `slot` argument, default `0`) has a `questionTypes` field set, use that slot's `questionTypes`.
2. Otherwise, if the seasons feature is enabled AND `findCurrentSeason` returns a non-null `SeasonEntry` whose `questionTypes` field is set, use that entry's `questionTypes`.
3. Otherwise (seasons disabled, `now` falls in a timeline gap, the current entry has no `format` or the slot has no `questionTypes`, AND the current entry has no top-level `questionTypes` field), use `config.trivia.questionsTypes`.
4. Otherwise (all sources absent), default to `{ "boolean": 1 }` (pure-boolean, equivalent to pre-change behavior).

The system SHALL re-read these sources on every `get_ideas` call — no caching, no pre-computation. The `choices.{min, max}` setting SHALL NOT be season-overridable or slot-overridable — it lives only at `config.trivia.choices` with defaults `{ min: 2, max: 4 }`.

#### Scenario: Slot's questionTypes overrides season's

- **GIVEN** seasons are enabled and the active season has `questionTypes: { boolean: 1, choice: 1 }` and `format: { questions: [{ questionTypes: { choice: 1 } }, {}] }`
- **WHEN** `get_ideas` is called with `slot: 0`
- **THEN** the resolved `questionTypes` is `{ choice: 1 }` (slot 0 overrides)
- **AND** `suggestedType` is always `"choice"`

#### Scenario: Slot without questionTypes falls back to season's

- **GIVEN** seasons are enabled and the active season has `questionTypes: { boolean: 2, choice: 1 }` and `format: { questions: [{}, {}] }`
- **WHEN** `get_ideas` is called with `slot: 1`
- **THEN** the resolved `questionTypes` is the season's `{ boolean: 2, choice: 1 }`

#### Scenario: Current season's questionTypes overrides config (no format)

- **GIVEN** seasons are enabled and `findCurrentSeason(state, now)` returns an entry with `questionTypes: { "choice": 1 }` and no `format`
- **AND** `config.trivia.questionsTypes` is `{ "boolean": 1 }`
- **WHEN** `get_ideas` is called
- **THEN** the returned `suggestedType` is always `"choice"`

#### Scenario: Current season without questionTypes or format falls back to config

- **GIVEN** seasons are enabled and the current `SeasonEntry` has no `questionTypes` field and no `format` field
- **AND** `config.trivia.questionsTypes` is `{ "boolean": 2, "choice": 1 }`
- **WHEN** `get_ideas` is called
- **THEN** the system uses `config.trivia.questionsTypes` weights for the random roll

#### Scenario: Timeline gap falls back to config

- **GIVEN** seasons are enabled but `findCurrentSeason(state, now)` returns `null` (now falls between seasons)
- **AND** `config.trivia.questionsTypes` is `{ "boolean": 2, "choice": 1 }`
- **WHEN** `get_ideas` is called
- **THEN** the system uses `config.trivia.questionsTypes` weights

#### Scenario: Seasons disabled uses config

- **GIVEN** seasons are disabled (`trivia.seasons.enabled: false` or absent)
- **AND** `config.trivia.questionsTypes` is `{ "boolean": 2, "choice": 1 }`
- **WHEN** `get_ideas` is called
- **THEN** the system uses `config.trivia.questionsTypes` weights for the random roll

#### Scenario: All sources absent defaults to boolean-only

- **GIVEN** seasons are enabled with no current entry questionTypes, no format, AND `config.trivia.questionsTypes` is absent
- **WHEN** `get_ideas` is called
- **THEN** the returned `suggestedType` is always `"boolean"`

#### Scenario: Mid-season format update via upsert_season takes effect on next call

- **GIVEN** `get_ideas(slot: 0)` was called once with no format
- **WHEN** `upsert_season(currentSlug, { format: { questions: [{ questionTypes: { choice: 1 } }] } })` is called and `get_ideas(slot: 0)` is called again
- **THEN** the second call uses the new slot 0's `questionTypes` of `{ choice: 1 }`

#### Scenario: Mid-season update via upsert_season takes effect on next call

- **GIVEN** `get_ideas` was called once with the current entry's previous `questionTypes`
- **WHEN** `upsert_season(currentSlug, { questionTypes: { "choice": 1 } })` is called and `get_ideas` is called again
- **THEN** the second call uses the updated weights

#### Scenario: choices.min/max is not per-season or per-slot

- **GIVEN** `config.trivia.choices` is `{ min: 2, max: 4 }`
- **AND** the active season has a `format` with slots that specify `questionTypes`
- **WHEN** `get_ideas` reads the choice bounds (for a choice-typed roll)
- **THEN** the bounds come from `config.trivia.choices` regardless of which slot is in play or what fields the season carries
