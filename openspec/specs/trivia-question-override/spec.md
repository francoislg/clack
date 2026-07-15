# trivia-question-override Specification

## Purpose
TBD - created by archiving change add-trivia-variable-points. Update Purpose after archive.
## Requirements
### Requirement: override_question admin tool with a hard field allowlist

The trivia plugin SHALL register an `override_question` MCP tool, gated to the `admin` role and registered always-on (NOT behind the `trivia:management` integration, so it appears in an admin session's catalog without `attach_integration`) — matching its sibling correction tool `override_answer`. It SHALL accept `game` (the lookup scope) and `questionId` plus a patch whose schema exposes EXACTLY two optional fields: `points` (integer, `1 <= points <= 10`) and `difficulty` (integer, `1 <= difficulty <= 10`). At least one patch field MUST be supplied. All other question-record fields SHALL be structurally unpatchable (absent from the schema): `statement`, `answersFormat`, answer-key fields (owned by `settle_question`), `suggestedDifficulty` (records what was ROLLED at generation — an audit fact that overwriting would falsify), `season`/`slot` stamps, and internal bookkeeping (`postedBlocks` as a direct target, `batchId`, `processedAt`).

`points` SHALL be validated against the ABSOLUTE `[1, 10]` bound and SHALL NOT be checked against the cascade-resolved `max`. The cascade `max` bounds what Claude may pick at generation time; it is neither a policy ceiling over admins nor a retroactive constraint. A config edit MUST NEVER cap already-posed questions: lowering a game's `max` after questions were posed SHALL leave their stamped values intact and SHALL NOT block an admin from reclassing them.

An override to `points: 1` SHALL be normalized to field removal on the record (absence reads as 1), matching `save_question` stamping semantics.

#### Scenario: Tool is admin-gated and always-on

- **WHEN** the trivia plugin registers its tools
- **THEN** `override_question` is gated to the `admin` role
- **AND** it is NOT registered behind the `trivia:management` integration (it appears in an admin session's catalog without `attach_integration`)

#### Scenario: Points reclass on a processed question

- **GIVEN** a revealed question stamped `points: 3`
- **WHEN** `override_question` is called with `points: 2`
- **THEN** the record's `points` becomes 2
- **AND** the next leaderboard computation pays 2 for every correct row on it (via the aggregation join — no answer rows are touched)

#### Scenario: Difficulty reclass

- **GIVEN** a question stamped `difficulty: 4`
- **WHEN** `override_question` is called with `difficulty: 8`
- **THEN** the record's `difficulty` becomes 8 and `suggestedDifficulty` is unchanged

#### Scenario: Override to one point removes the field

- **GIVEN** a question stamped `points: 2`
- **WHEN** `override_question` is called with `points: 1`
- **THEN** the persisted record has NO `points` field

#### Scenario: Override is not bounded by the live cascade max

- **GIVEN** a game whose resolved `points` is `{ max: 1 }` (or `{ max: 2 }`), and a question posed earlier under a higher cap
- **WHEN** `override_question` is called with `points: 3`
- **THEN** the override succeeds — the live cap does not constrain it

#### Scenario: Lowering the cap leaves posed questions alone

- **GIVEN** a question stamped `points: 3`
- **WHEN** the game's `points.max` is later lowered to 1
- **THEN** the question's stamped `points` stays 3, it still pays 3 on every scoring surface, and an admin may still reclass it to any value in `[1, 10]`

#### Scenario: Empty and out-of-range patches are rejected

- **WHEN** `override_question` is called with no patch fields, or with `points: 0`, `points: 11`, or a non-integer value
- **THEN** the tool returns an actionable error and writes nothing

#### Scenario: Unknown question is rejected

- **WHEN** `override_question` is called with a `questionId` that does not exist for the game
- **THEN** the tool returns an error and writes nothing

### Requirement: Per-field originals are captured once for restore

On the FIRST override of a given field, `override_question` SHALL capture that field's pre-override value (including "absent") on the record, following the `override_answer` `originalVerdict` pattern: subsequent overrides of the same field SHALL NOT overwrite the captured original. The captured originals SHALL be surfaced in the tool result and by `find_previous_questions` on any row that carries them, so the generation-time fact is never lost.

#### Scenario: First override captures, second preserves

- **GIVEN** a question stamped `points: 3`
- **WHEN** `override_question` sets `points: 2` and later `points: 4`
- **THEN** the record holds `points: 4` and the captured original remains 3

#### Scenario: Absence is a capturable original

- **GIVEN** a question with no `points` field (worth 1)
- **WHEN** `override_question` sets `points: 2`
- **THEN** the captured original records that `points` was absent, enabling a restore to 1-point behavior

### Requirement: Points override rewrites the worth-block and hints a repaint

When an override changes `points`, the tool SHALL rewrite the "worth N points" context block INSIDE the stored `postedBlocks` of an already-posted question — inserting it (new value > 1 where none existed), replacing its text (value changed), or removing it (new value is 1) — and the tool result SHALL carry a `refreshHint` so Claude repaints the live card. Leaving `postedBlocks` stale is not permitted: live-roster rebuilds compose from `postedBlocks` and would resurrect the old value on the next click. A `difficulty`-only override SHALL NOT touch `postedBlocks` and SHALL NOT return a `refreshHint` (difficulty is never rendered on the card, and hint presence is driven by the stamped `hint` object, not by difficulty).

#### Scenario: Repricing a posted card updates the stored blocks

- **GIVEN** a posted question stamped `points: 2` whose `postedBlocks` contain the worth-block
- **WHEN** `override_question` sets `points: 3`
- **THEN** the stored `postedBlocks` worth-block now reads the localized "Worth 3 points" text
- **AND** the tool result carries a `refreshHint`
- **AND** a subsequent live-roster rebuild renders the new value

#### Scenario: Demoting to one point removes the block

- **GIVEN** a posted question stamped `points: 2`
- **WHEN** `override_question` sets `points: 1`
- **THEN** the worth-block is removed from `postedBlocks` and a `refreshHint` is returned

#### Scenario: Difficulty reclass leaves the card alone

- **GIVEN** a posted question with a button-mode hint, generated at `difficulty: 4`
- **WHEN** `override_question` sets `difficulty: 8`
- **THEN** `postedBlocks` are untouched, no `refreshHint` is returned, and the Get Hint button is unaffected (hint rendering follows the stamped `hint` object, never difficulty)

#### Scenario: Unposted question needs no block surgery

- **GIVEN** a staged (never-posted) question stamped `points: 2` with no `postedBlocks`
- **WHEN** `override_question` sets `points: 3`
- **THEN** the record is restamped, no `refreshHint` is returned, and the eventual `post_questions` renders the new value

