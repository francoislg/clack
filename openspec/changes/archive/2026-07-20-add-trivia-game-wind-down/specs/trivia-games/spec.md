# trivia-games — delta for add-trivia-game-wind-down

## ADDED Requirements

### Requirement: disableAfterRound field on TriviaGame

The `parseTriviaGames` function SHALL accept an optional `disableAfterRound: boolean` field on each entry (graceful: absent ≡ `false`; malformed non-boolean drops the FIELD with a parse issue while preserving the entry, consistent with the sibling optional booleans `tagPlayers`/`scrollToTop`). The field is game-tier ONLY — no workspace default, no season/slot tier, not a `CascadeAxes` member.

Surfacing SHALL follow the `tagPlayers`/`tellMeMore` pattern:

- `upsert_game` SHALL accept `disableAfterRound` with omit-to-keep / explicit-`null`-to-clear semantics on UPDATE, and store it verbatim on CREATE when provided.
- `list_games` SHALL surface `disableAfterRound` in a game's entry when set.

The field's behavioral semantics (wind-down at season close) are specified in the `trivia-game-wind-down` capability.

#### Scenario: upsert_game sets and clears the flag

- **WHEN** `upsert_game` is called with `disableAfterRound: true` for an existing game
- **THEN** the persisted entry carries `disableAfterRound: true`
- **AND** a later `upsert_game` call with `disableAfterRound: null` removes the field
- **AND** a later `upsert_game` call omitting the field preserves the existing value

#### Scenario: list_games surfaces the flag

- **GIVEN** a game with `disableAfterRound: true`
- **WHEN** `list_games` is invoked
- **THEN** the game's entry reports `disableAfterRound: true`
- **AND** games without the field do not report it
