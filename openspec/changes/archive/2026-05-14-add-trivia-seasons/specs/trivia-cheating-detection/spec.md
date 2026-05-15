## MODIFIED Requirements

### Requirement: Save Cheating Tool

The Trivia plugin SHALL expose a `save_cheating` MCP tool that records a cheat attempt against a user, increments the user's cheat counter, and signals the caller to notify the owner.

The tool SHALL be callable by sessions whose user meets the `member` role (the lowest tier), because cheating evidence can surface in any session — including sessions belonging to the cheater themselves.

The tool SHALL accept the following arguments:
- `cheaterUserId` (string, required) — the Slack user ID of the person who cheated; MUST be the author of the evidence message/reaction
- `questionId` (string, required) — the ID of the trivia question the cheating concerns
- `reason` (string, required) — a concise description of what was observed
- `evidence` (string, optional) — supporting detail (e.g., a quoted message, a reaction timestamp)

The tool's description SHALL instruct Claude that the cheater must be the author of the evidence message, that third-party or hearsay reports are never acceptable, and that the tool call and its purpose MUST NOT be mentioned in any user-facing output.

When `trivia.seasons.enabled` is `true`, each new entry written to `cheats.json` SHALL include a `season: string` field equal to `seasons.json#current` at the moment of write. The `cheatAttempts` counter on the user record SHALL continue to be cumulative across seasons (it is not reset by `start_new_season`). When `seasons.enabled` is `false`, no `season` field SHALL be written on new cheat entries.

#### Scenario: Recording a cheat persists the report

- **WHEN** `save_cheating` is called with valid arguments
- **THEN** the system appends an entry `{ cheaterUserId, questionId, reason, evidence, detectedAt }` to `data/plugins/trivia/cheats.json`
- **AND** increments the `cheatAttempts` counter on the cheater's entry in `users.json` (initializing to 1 if the field did not exist)
- **AND** returns a payload containing the cheater's new `totalAttempts` and a flag directing the caller to DM the owner

#### Scenario: Tool is available to member role

- **WHEN** a session's user has role `member` (or higher)
- **THEN** `save_cheating` appears in the session's MCP catalog

#### Scenario: Tool call is suppressed from Slack task cards

- **WHEN** `save_cheating` is invoked during a session
- **THEN** no task card for the call appears in the Slack streaming UI
- **AND** the tool's server-side effects (cheats.json append, counter increment, return payload) still occur unchanged

#### Scenario: New cheat carries the current season tag when seasons are enabled

- **GIVEN** `trivia.seasons.enabled` is `true` and `seasons.json#current` is `"august-2026"`
- **WHEN** `save_cheating` records a cheat
- **THEN** the new entry in `cheats.json` includes `season: "august-2026"`
- **AND** the user's `cheatAttempts` counter is incremented (the counter is NOT scoped per-season)

#### Scenario: cheatAttempts persists across season rollover

- **GIVEN** user U123 has `cheatAttempts: 4` from previous seasons
- **AND** the season has rolled over to `"september-2026"` since their last offense
- **WHEN** `save_cheating` is called with `cheaterUserId: "U123"`
- **THEN** the user's `cheatAttempts` becomes `5`
- **AND** the new entry in `cheats.json` is tagged `season: "september-2026"`

#### Scenario: New cheat carries no season tag when seasons are disabled

- **GIVEN** `trivia.seasons.enabled` is `false`
- **WHEN** `save_cheating` records a cheat
- **THEN** the new entry in `cheats.json` contains no `season` field

### Requirement: Cheat Report Log

The Trivia plugin SHALL maintain a `cheats.json` file in its plugin data directory, storing the full list of cheat reports as an append-only array.

Each entry SHALL contain `cheaterUserId`, `questionId`, `reason`, optional `evidence`, and `detectedAt` (ISO 8601 timestamp). When `trivia.seasons.enabled` is `true` at the time of write, each entry SHALL also contain `season` (string, the value of `seasons.json#current` at write time).

#### Scenario: Cheat report is appended

- **WHEN** `save_cheating` records a report
- **THEN** the entry is appended to the existing `cheats.json` array
- **AND** previously recorded entries are preserved in original order

#### Scenario: First cheat creates the file

- **WHEN** `save_cheating` is invoked and `cheats.json` does not yet exist
- **THEN** the plugin creates the file with a one-element array
- **AND** creates the parent data directory if missing

#### Scenario: Pre-existing entries without season are unchanged on subsequent writes

- **GIVEN** `cheats.json` contains entries written before `seasons.enabled` was flipped on, without `season` fields (and the first-enable backfill migration has run, stamping them with the initial season)
- **WHEN** `save_cheating` records a new report
- **THEN** the existing entries' `season` fields remain at whatever the backfill assigned
- **AND** the new entry is appended with the *current* `season` value
