## ADDED Requirements

### Requirement: list_games surfaces lockCron

The `list_games` MCP tool SHALL include `lockCron` per-entry in its response when the corresponding `TriviaGame` has `lockCron` set. When the game has no `lockCron`, the field SHALL be omitted from that entry's response (not emitted as `null` or empty string).

#### Scenario: lockCron appears in list_games output

- **GIVEN** `config.trivia.games[0]` has `lockCron: "0 12 * * *"`
- **WHEN** `list_games` is called
- **THEN** the response entry for that game includes `lockCron: "0 12 * * *"` alongside `questionCron`, `revealCron`, `timezone`, and `channel`

#### Scenario: list_games omits lockCron when unset

- **GIVEN** `config.trivia.games[0]` has no `lockCron` field
- **WHEN** `list_games` is called
- **THEN** the response entry for that game does NOT include `lockCron` (not `null`, not empty string — absent)

### Requirement: upsert_game accepts lockCron

The `upsert_game` MCP tool SHALL accept an optional `lockCron: string` argument. When supplied, the tool SHALL validate it as a cron expression in the game's `timezone` and persist it on the game entry. When omitted, the existing field on the game (if any) SHALL be preserved unchanged. Removing a previously-set `lockCron` SHALL be supported via an explicit empty string or null sentinel value (consistent with how other optional fields are cleared in `upsert_game`).

#### Scenario: upsert_game adds lockCron to an existing game

- **GIVEN** game `main` exists with no `lockCron`
- **WHEN** `upsert_game({ name: "main", lockCron: "0 12 * * *" })` is called
- **THEN** the game's `lockCron` field is set to `"0 12 * * *"`
- **AND** the next plugin reconcile emits a `main:lock` spec

#### Scenario: upsert_game rejects invalid lockCron

- **GIVEN** an admin calls `upsert_game({ name: "main", lockCron: "not a cron" })`
- **WHEN** the tool validates the input
- **THEN** the tool returns a validation error citing the invalid cron expression
- **AND** the game's `lockCron` field is unchanged

#### Scenario: upsert_game clears lockCron via sentinel

- **GIVEN** game `main` has `lockCron: "0 12 * * *"`
- **WHEN** `upsert_game({ name: "main", lockCron: null })` is called (or empty-string sentinel)
- **THEN** the game's `lockCron` field is removed
- **AND** the next plugin reconcile emits no `main:lock` spec
