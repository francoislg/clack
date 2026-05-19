## MODIFIED Requirements

### Requirement: Save Cheating Tool

The Trivia plugin SHALL expose a `save_cheating` MCP tool that records a cheat attempt against a user within a specified game, increments the user's global cheat counter, and signals the caller to notify the owner.

The tool SHALL be callable by sessions whose user meets the `member` role (the lowest tier), because cheating evidence can surface in any session — including sessions belonging to the cheater themselves.

The tool SHALL accept the following arguments:

- `game` (string, required) — the game slug; validated against the games registry per the `trivia-games` capability. Unknown slug → structured error; disabled slug → structured "game is disabled" error (cheat reports are writes).
- `cheaterUserId` (string, required) — the Slack user ID of the person who cheated; MUST be the author of the evidence message/reaction.
- `questionId` (string, required) — the ID of the trivia question (within the named game) the cheating concerns.
- `reason` (string, required) — a concise description of what was observed.
- `evidence` (string, optional) — supporting detail (e.g., a quoted message, a reaction timestamp).

The cheat report SHALL be appended to `data/plugins/trivia/games/<game>/cheats.json` — never to a flat-file `cheats.json` at the trivia root, and never to another game's file.

The `cheatAttempts` counter on the user record in the global `data/plugins/trivia/users.json` SHALL be incremented. The counter is **global, not per-game** — a cheater's tally is cumulative across every game they cheat in.

The tool's description SHALL instruct Claude that the cheater must be the author of the evidence message, that third-party or hearsay reports are never acceptable, and that the tool call and its purpose MUST NOT be mentioned in any user-facing output.

When `trivia.seasons.enabled` is `true` AND `findCurrentSeason(games/<game>/seasons.json, now)` returns a season, each new entry written to the game's `cheats.json` SHALL include a `season: string` field equal to that season's slug. The `cheatAttempts` counter on the user record SHALL continue to be cumulative across seasons AND across games. When seasons are disabled OR `findCurrentSeason` returns `null` (gap) for the game's timeline, no `season` field is written on new cheat entries.

#### Scenario: Recording a cheat persists the report into the game's directory

- **WHEN** `save_cheating` is called with `game: "main"` and valid arguments
- **THEN** the system appends an entry `{ cheaterUserId, questionId, reason, evidence, detectedAt }` to `data/plugins/trivia/games/main/cheats.json`
- **AND** increments the `cheatAttempts` counter on the cheater's entry in the global `data/plugins/trivia/users.json` (initializing to 1 if the field did not exist)
- **AND** returns a payload containing the cheater's new `totalAttempts` and a flag directing the caller to DM the owner

#### Scenario: Cheat tallies are global across games

- **GIVEN** user `U123` has `cheatAttempts: 3` in the global `users.json` (from prior offenses in `games/main/`)
- **WHEN** `save_cheating` is called with `game: "sandbox", cheaterUserId: "U123", ...`
- **THEN** a new entry is appended to `games/sandbox/cheats.json`
- **AND** the global `users.json` updates `U123`'s `cheatAttempts` to `4`
- **AND** `games/main/cheats.json` is unchanged

#### Scenario: Unknown game rejected

- **WHEN** `save_cheating` is called with `game: "ghost"` (not in the registry)
- **THEN** the tool returns a structured "unknown game" error
- **AND** no file is created or modified

#### Scenario: Disabled game refuses cheat write

- **GIVEN** `games.json` marks `retired-2025` as `disabled: true`
- **WHEN** `save_cheating` is called with `game: "retired-2025"` and otherwise-valid args
- **THEN** the tool returns a structured "game is disabled" error
- **AND** `games/retired-2025/cheats.json` is unchanged
- **AND** the global `users.json` is unchanged

#### Scenario: Tool is available to member role

- **WHEN** a session's user has role `member` (or higher)
- **THEN** `save_cheating` appears in the session's MCP catalog

#### Scenario: Tool call is suppressed from Slack task cards

- **WHEN** `save_cheating` is invoked during a session
- **THEN** no task card for the call appears in the Slack streaming UI
- **AND** the tool's server-side effects (per-game cheats.json append, global counter increment, return payload) still occur unchanged

#### Scenario: New cheat carries the current season tag when seasons are enabled for the game

- **GIVEN** `trivia.seasons.enabled` is `true` and `games/main/seasons.json` has a current entry with slug `"august-2026"`
- **WHEN** `save_cheating` is called with `game: "main"` and records a cheat
- **THEN** the new entry in `games/main/cheats.json` includes `season: "august-2026"`
- **AND** the user's `cheatAttempts` counter is incremented (the counter is NOT scoped per-season or per-game)

#### Scenario: cheatAttempts persists across season rollover

- **GIVEN** user U123 has `cheatAttempts: 4` from previous seasons (across any games)
- **AND** the named game's season has rolled over to `"september-2026"` since their last offense
- **WHEN** `save_cheating` is called with `game: "main", cheaterUserId: "U123"`
- **THEN** the user's `cheatAttempts` becomes `5` in the global `users.json`
- **AND** the new entry in `games/main/cheats.json` is tagged `season: "september-2026"`

#### Scenario: New cheat carries no season tag when seasons are disabled

- **GIVEN** `trivia.seasons.enabled` is `false`
- **WHEN** `save_cheating` is called with `game: "main"` and records a cheat
- **THEN** the new entry in `games/main/cheats.json` contains no `season` field

### Requirement: Cheat Report Log

The Trivia plugin SHALL maintain a `cheats.json` file inside each registered game's directory (`data/plugins/trivia/games/<game>/cheats.json`), storing that game's full list of cheat reports as an append-only array.

Each entry SHALL contain `cheaterUserId`, `questionId`, `reason`, optional `evidence`, and `detectedAt` (ISO 8601 timestamp). When `trivia.seasons.enabled` is `true` AND `findCurrentSeason(games/<game>/seasons.json, now)` returns a season at write time, each entry SHALL also contain `season` (string, the active season's slug). When seasons are disabled or the game's timeline is in a gap, no `season` field is written.

Each game's `cheats.json` is independent — a cheat recorded in `games/sandbox/cheats.json` is NOT visible to tools reading `games/main/cheats.json`.

#### Scenario: Cheat report is appended to the named game's file

- **WHEN** `save_cheating` records a report with `game: "main"`
- **THEN** the entry is appended to the existing `games/main/cheats.json` array
- **AND** previously recorded entries in `games/main/cheats.json` are preserved in original order
- **AND** other games' `cheats.json` files are unchanged

#### Scenario: First cheat creates the file

- **WHEN** `save_cheating` is invoked with `game: "main"` and `games/main/cheats.json` does not yet exist
- **THEN** the plugin creates the file with a one-element array
- **AND** creates the parent data directory if missing

### Requirement: Cheat data is admin-only on read

Any MCP tool that exposes the contents of any game's `cheats.json` — directly or in any derived shape (e.g. a per-question cheater list, a per-user cheat history, an aggregate count keyed to identifiable users) — SHALL be gated to the `admin` role or stricter.

This requirement complements the existing write-side constraint (`save_cheating` is callable by `member`, but its description forbids surfacing the call): now that cheat data is consumable by tools (see `trivia-question-search` → `get_question_history`), the read side SHALL be access-controlled so cheater identities never reach a non-admin session's MCP catalog.

The owner DM produced as a side effect of `save_cheating` is not affected by this requirement; it is a server-initiated message to the configured deployment owner, not a tool result returned to a session.

#### Scenario: Per-question cheater lookup is admin-only

- **WHEN** any tool that returns cheater identities for a given `(game, questionId)` is registered with the SDK
- **THEN** its role gate is `admin` or stricter
- **AND** sessions whose user role is below `admin` do not see the tool in their MCP catalog

#### Scenario: Member-tier search tools do not leak cheater identities

- **WHEN** `find_previous_questions` (or any future member-tier discovery tool) is invoked
- **THEN** the response contains no field naming any user as a cheater
- **AND** the response contains no aggregated cheat counter keyed to a specific user

#### Scenario: Owner DM side effect is unchanged

- **WHEN** `save_cheating` records a cheat
- **THEN** the deployment owner DM is delivered as before
- **AND** no role gate on read tooling is applied to that DM (it is a server-initiated message, not a tool result)
