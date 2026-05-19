## MODIFIED Requirements

### Requirement: Save Cheating Tool

The Trivia plugin SHALL expose a `save_cheating` MCP tool that records a cheat attempt against a user within a specified game, increments the user's global cheat counter, and signals the caller to notify the owner.

The tool SHALL be callable by sessions whose user meets the `member` role.

The tool SHALL accept the following arguments:

- `game` (string, required) — validated against `config.trivia.games[]` per the `trivia-games` capability. Unknown name → structured "unknown game" error; `enabled: false` entry → structured "game is disabled" error (write tool).
- `cheaterUserId` (string, required) — the Slack user ID of the cheater; MUST be the author of the evidence message/reaction.
- `questionId` (string, required) — the ID of the trivia question within the named game.
- `reason` (string, required) — a concise description of what was observed.
- `evidence` (string, optional) — supporting detail.

The cheat report SHALL be appended to `data/plugins/trivia/games/<game>/cheats.json`.

The `cheatAttempts` counter on the user record in the global `data/plugins/trivia/users.json` SHALL be incremented. The counter is **global** — a cheater's tally is cumulative across every game.

The tool's description SHALL instruct Claude that the cheater must be the author of the evidence message, that third-party reports are never acceptable, and that the tool call MUST NOT be mentioned in any user-facing output.

When `trivia.seasons.enabled` is `true` AND `findCurrentSeason(games/<game>/seasons.json, now)` returns a season, each new entry SHALL include `season: string` equal to that season's slug. The `cheatAttempts` counter SHALL continue cumulative across seasons AND across games.

#### Scenario: Recording a cheat persists the report into the game's directory

- **WHEN** `save_cheating` is called with `game: "main"` and valid arguments
- **THEN** an entry is appended to `data/plugins/trivia/games/main/cheats.json`
- **AND** the cheater's `cheatAttempts` is incremented in the global `data/plugins/trivia/users.json`
- **AND** the response includes the cheater's new `totalAttempts` and the owner-DM flag

#### Scenario: Cheat tallies are global across games

- **GIVEN** user `U123` has `cheatAttempts: 3` in the global `users.json`
- **WHEN** `save_cheating` is called with `game: "sandbox", cheaterUserId: "U123", ...`
- **THEN** a new entry is appended to `games/sandbox/cheats.json`
- **AND** the global `users.json` updates `U123`'s `cheatAttempts` to `4`
- **AND** `games/main/cheats.json` is unchanged

#### Scenario: Unknown game rejected

- **WHEN** `save_cheating` is called with `game: "ghost"`
- **THEN** the tool returns a structured "unknown game" error

#### Scenario: Disabled game refuses cheat write

- **GIVEN** `config.trivia.games[]` contains `{ name: "retired", enabled: false, ... }`
- **WHEN** `save_cheating` is called with `game: "retired"` and otherwise-valid args
- **THEN** the tool returns a structured "game is disabled" error
- **AND** the global `users.json` is unchanged

#### Scenario: Tool is available to member role

- **WHEN** a session's user has role `member` (or higher)
- **THEN** `save_cheating` appears in the session's MCP catalog

#### Scenario: Tool call is suppressed from Slack task cards

- **WHEN** `save_cheating` is invoked
- **THEN** no task card for the call appears in the Slack streaming UI
- **AND** the tool's server-side effects still occur unchanged

#### Scenario: New cheat carries the current season tag

- **GIVEN** `trivia.seasons.enabled` is `true` and `games/main/seasons.json` has current slug `"august-2026"`
- **WHEN** `save_cheating` is called with `game: "main"` and records a cheat
- **THEN** the new entry in `games/main/cheats.json` includes `season: "august-2026"`

#### Scenario: cheatAttempts persists across season rollover

- **GIVEN** user U123 has `cheatAttempts: 4`
- **WHEN** `save_cheating` is called with `game: "main"` after the game's season has rolled over
- **THEN** the user's `cheatAttempts` becomes `5`
- **AND** the new entry in `games/main/cheats.json` is tagged with the new season slug

#### Scenario: New cheat carries no season tag when seasons are disabled

- **GIVEN** `trivia.seasons.enabled` is `false`
- **WHEN** `save_cheating` is called with `game: "main"`
- **THEN** the new entry in `games/main/cheats.json` contains no `season` field

### Requirement: Cheat Report Log

The Trivia plugin SHALL maintain a `cheats.json` file inside each registered game's directory (`data/plugins/trivia/games/<game>/cheats.json`), storing that game's full list of cheat reports as an append-only array.

Each entry SHALL contain `cheaterUserId`, `questionId`, `reason`, optional `evidence`, and `detectedAt` (ISO 8601 timestamp). When `trivia.seasons.enabled` is `true` AND `findCurrentSeason(games/<game>/seasons.json, now)` returns a season at write time, each entry SHALL also contain `season`.

Each game's `cheats.json` is independent — a cheat recorded in `games/sandbox/cheats.json` is NOT visible to tools reading `games/main/cheats.json`.

#### Scenario: Cheat report is appended to the named game's file

- **WHEN** `save_cheating` records a report with `game: "main"`
- **THEN** the entry is appended to the existing `games/main/cheats.json` array
- **AND** other games' `cheats.json` files are unchanged

#### Scenario: First cheat creates the file

- **WHEN** `save_cheating` is invoked with `game: "main"` and `games/main/cheats.json` does not yet exist
- **THEN** the plugin creates the file with a one-element array
- **AND** creates the parent data directory if missing

### Requirement: Cheat data is admin-only on read

Any MCP tool that exposes the contents of any game's `cheats.json` — directly or in any derived shape — SHALL be gated to the `admin` role or stricter.

The owner DM produced as a side effect of `save_cheating` is not affected by this requirement.

#### Scenario: Per-question cheater lookup is admin-only

- **WHEN** any tool returning cheater identities for a given `(game, questionId)` is registered with the SDK
- **THEN** its role gate is `admin` or stricter

#### Scenario: Member-tier search tools do not leak cheater identities

- **WHEN** `find_previous_questions` (or any future member-tier discovery tool) is invoked
- **THEN** the response contains no field naming any user as a cheater

#### Scenario: Owner DM side effect is unchanged

- **WHEN** `save_cheating` records a cheat
- **THEN** the deployment owner DM is delivered as before
