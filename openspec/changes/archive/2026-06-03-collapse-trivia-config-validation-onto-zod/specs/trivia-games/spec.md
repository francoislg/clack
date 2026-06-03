## ADDED Requirements

### Requirement: Game config validation is schema-driven

Validation of `TriviaGame` config fields (the axis weight maps, `format`/`slotOverrides` slots, `categories`, `theme`, `instructions`, `additionalInstructions`, per-format `difficulty` ranges) SHALL be expressed as a single rich zod schema per concept that encodes both shape and semantics (trim, dedup-preserving-order, weight maps non-negative with at least one strictly positive, `[min,max]` ranges within 1–10 with min≤max). The system SHALL NOT maintain a second hand-rolled validator layer for the same fields. Both the lenient file-load parser (`parseTriviaGames`) and the strict `upsert_game` tool path SHALL validate against the same schema object via `safeParse`; only the wrapping of the result differs (lenient accumulates + logs, strict rejects).

#### Scenario: A single schema gates both load and tool paths

- **WHEN** the same malformed game field (e.g. an `answersFormat` weight map with all-zero weights) is supplied both via `config.json` at load time and via `upsert_game`
- **THEN** both paths reject it through the same zod schema, the file-load path records a `ParseIssue` and drops the field while keeping the game, and the tool path returns an error result — with no separate hand-rolled validator consulted

#### Scenario: Lenient and strict paths differ only in wrapping

- **WHEN** any invalid field is validated through the file-load path versus the `upsert_game` tool path
- **THEN** both call `safeParse` on the identical schema object, the file-load path accumulates the issue, logs a warning, and drops the field while keeping the rest of the game, and the tool path returns an error result and does NOT apply the change — neither path consults a separate validator, so the two cannot diverge in which inputs they accept

#### Scenario: slotOverrides validated per-slot under numeric-string keys

- **WHEN** a `slotOverrides` record is supplied with a non-numeric key, or with a slot value that fails the slot schema (e.g. an `answersFormat` with no positive weight)
- **THEN** the schema rejects it with a path-labeled error (e.g. `'slotOverrides.2.answersFormat' must have at least one strictly positive weight`), using the same slot schema applied to `format.questions[n]`

#### Scenario: Adding an axis requires only the schema

- **WHEN** a new validated field is added to a slot or game
- **THEN** the validation rule is added in exactly one schema definition and is honored by every consumer, with no parallel `validate*` function to keep in sync

### Requirement: Game config error-message parity is preserved

The migration to schema-driven validation SHALL preserve the existing labeled error-message contract. Rejection messages SHALL retain their `'field.path' must …` form (path prefix supplied by the shared `zodErrorToResult` formatter, per-rule message from the schema), such that existing tests asserting exact error strings continue to pass unchanged.

#### Scenario: Error strings are byte-identical across every rejection mode

- **WHEN** any invalid game field is validated after the migration — including an `answersFormat` weight map with no positive weight, an unknown key in a weight map, a non-integer weight, a `categories` array that dedupes to empty, an empty-after-trim `theme`, and a difficulty range with `min > max`
- **THEN** each returned error string matches the corresponding pre-migration string captured by the characterization test exactly, and the existing per-validator unit tests asserting those strings continue to pass unchanged
