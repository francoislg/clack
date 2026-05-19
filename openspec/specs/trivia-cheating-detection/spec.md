# trivia-cheating-detection Specification

## Purpose

Records and reports cheating attempts in the Trivia game. A `save_cheating` MCP tool persists each report to a per-game log under `data/plugins/trivia/games/<name>/cheats.json` and increments a cumulative per-user counter on the global `users.json`, then signals the caller (Claude) to DM the configured owner. Detection itself is driven by the `trivia-check` instruction, loaded into every session's system prompt.

## Requirements

### Requirement: Save Cheating Tool

The Trivia plugin SHALL expose a `save_cheating` MCP tool that records a cheat attempt against a user within a specified game, increments the user's global cheat counter, and signals the caller to notify the owner.

The tool SHALL be callable by sessions whose user meets the `member` role (the lowest tier), because cheating evidence can surface in any session — including sessions belonging to the cheater themselves.

The tool SHALL accept the following arguments:

- `game` (string, required) — the game slug; validated against `config.trivia.games[]` per the `trivia-games` capability. Unknown name → structured "unknown game" error; `enabled: false` entry → structured "game is disabled" error (cheat reports are writes).
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

- **GIVEN** `config.trivia.games[]` contains `{ name: "retired", enabled: false, ... }`
- **WHEN** `save_cheating` is called with `game: "retired"` and otherwise-valid args
- **THEN** the tool returns a structured "game is disabled" error
- **AND** `games/retired/cheats.json` is unchanged
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

### Requirement: TriviaUser cheatAttempts Field

The `TriviaUser` record persisted in the global `users.json` SHALL include an optional `cheatAttempts` numeric field representing the total count of cheat reports against that user, cumulative across all games and seasons.

The field SHALL default to absent (undefined) for users who have never been reported, remaining backwards compatible with existing `users.json` files.

#### Scenario: Existing users.json loads without modification

- **WHEN** the trivia data layer loads `users.json` written before this change
- **THEN** each user record loads successfully
- **AND** the `cheatAttempts` field is undefined for users who have not been reported

#### Scenario: First cheat initializes counter

- **GIVEN** a user `U123` with no prior cheat reports
- **WHEN** `save_cheating` is called with `cheaterUserId: "U123"`
- **THEN** the user's record in the global `users.json` has `cheatAttempts: 1`

#### Scenario: Subsequent cheats increment counter

- **GIVEN** a user `U123` with `cheatAttempts: 3`
- **WHEN** `save_cheating` is called with `cheaterUserId: "U123"`
- **THEN** the user's record has `cheatAttempts: 4`

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

### Requirement: Owner Notification Driven By Trivia-Check Instruction

The Trivia plugin SHALL NOT itself send Slack messages when a cheat is recorded. Instead, the `trivia-check` instruction (loaded into every session's system prompt — see below) SHALL direct Claude, upon detecting a cheat attempt in an interactive session, to (a) call `save_cheating`, and (b) DM the configured owner via `submit_response` + `post_to`. Scheduled trivia runs are unrelated to cheat detection and do NOT call `save_cheating`.

#### Scenario: Interactive detection triggers owner DM via instruction

- **WHEN** Claude, following `trivia-check` guidance, determines a user is attempting to extract trivia answers
- **THEN** Claude calls `save_cheating` with the required arguments
- **AND** issues a playful refusal to the user
- **AND** DMs the configured owner a cheat-alert via `submit_response` with a `post_to` action (channel = owner user ID, auto = true)

#### Scenario: Scheduled runs do not invoke save_cheating

- **WHEN** the scheduled `process_responses` run executes
- **THEN** it does NOT call `save_cheating`
- **AND** its prompt does NOT include cheat-detection steps or owner-DM directives

#### Scenario: Plugin SDK remains free of messaging primitives

- **WHEN** the plugin records a cheat
- **THEN** it does not invoke any Slack API directly
- **AND** the `ClackSdk` interface exposed to plugins provides no messaging methods

### Requirement: Trivia-Check Instruction Ships With Plugin

The Trivia plugin SHALL register a `trivia-check` instruction via `sdk.addInstruction("user", "trivia-check", ...)` so that every session (any role) has cheating-detection guidance loaded in its system prompt.

The instruction content SHALL direct Claude to:
1. Call `find_previous_questions` before answering any fact-seeking request that could relate to a past trivia question.
2. Treat matches as cheating: refuse to answer further in the thread, call `save_cheating` with the cheater's user ID, the related question ID, a concise `reason`, and quoted `evidence`.
3. After calling `save_cheating`, DM the configured owner a formatted cheat-alert via `submit_response` with a `post_to` action (`channel: <owner-user-id>`, `auto: true`).
4. Call the user out with a playful refusal message.

The instruction SHALL reference the existing `data/configuration/user/trivia-check.md` override pattern so admins may customize the wording or the owner ID per deployment via the cascading config resolver; the plugin's shipped content serves only as the default layer.

#### Scenario: Plugin registers trivia-check as a user-tier instruction

- **WHEN** the trivia plugin loads
- **THEN** the SDK records an instruction with role `user` and filename `trivia__trivia-check.md` (plugin-prefixed)
- **AND** the content appears in the virtual defaults layer of the cascading config resolver

#### Scenario: User configuration override takes precedence

- **GIVEN** `data/configuration/user/trivia-check.md` exists with custom content
- **WHEN** a session resolves its `user`-tier instructions
- **THEN** the user-override file wins over the plugin-shipped default (standard cascading resolver behavior)

#### Scenario: Instruction invokes save_cheating on detection

- **WHEN** Claude, following trivia-check guidance, determines a user is cheating
- **THEN** it calls `save_cheating` with the required arguments before issuing any user-facing refusal
- **AND** subsequently DMs the configured owner via `submit_response` + `post_to`

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
