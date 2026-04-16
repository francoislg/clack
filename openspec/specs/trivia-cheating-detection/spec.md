# trivia-cheating-detection Specification

## Purpose
Records and reports cheating attempts in the Trivia game. A `save_cheating` MCP tool persists each report to a per-plugin log, increments a per-user counter, and signals the caller (Claude) to DM the configured owner. Detection itself is driven by the `trivia-check` instruction, loaded into every session's system prompt.

## Requirements

### Requirement: Save Cheating Tool

The Trivia plugin SHALL expose a `save_cheating` MCP tool that records a cheat attempt against a user, increments the user's cheat counter, and signals the caller to notify the owner.

The tool SHALL be callable by sessions whose user meets the `member` role (the lowest tier), because cheating evidence can surface in any session — including sessions belonging to the cheater themselves.

The tool SHALL accept the following arguments:
- `cheaterUserId` (string, required) — the Slack user ID of the person who cheated; MUST be the author of the evidence message/reaction
- `questionId` (string, required) — the ID of the trivia question the cheating concerns
- `reason` (string, required) — a concise description of what was observed
- `evidence` (string, optional) — supporting detail (e.g., a quoted message, a reaction timestamp)

The tool's description SHALL instruct Claude that the cheater must be the author of the evidence message, that third-party or hearsay reports are never acceptable, and that the tool call and its purpose MUST NOT be mentioned in any user-facing output.

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

### Requirement: TriviaUser cheatAttempts Field

The `TriviaUser` record persisted in `users.json` SHALL include an optional `cheatAttempts` numeric field representing the total count of cheat reports against that user.

The field SHALL default to absent (undefined) for users who have never been reported, remaining backwards compatible with existing `users.json` files.

#### Scenario: Existing users.json loads without modification

- **WHEN** the trivia data layer loads `users.json` written before this change
- **THEN** each user record loads successfully
- **AND** the `cheatAttempts` field is undefined for users who have not been reported

#### Scenario: First cheat initializes counter

- **GIVEN** a user `U123` with no prior cheat reports
- **WHEN** `save_cheating` is called with `cheaterUserId: "U123"`
- **THEN** the user's record in `users.json` has `cheatAttempts: 1`

#### Scenario: Subsequent cheats increment counter

- **GIVEN** a user `U123` with `cheatAttempts: 3`
- **WHEN** `save_cheating` is called with `cheaterUserId: "U123"`
- **THEN** the user's record has `cheatAttempts: 4`

### Requirement: Cheat Report Log

The Trivia plugin SHALL maintain a `cheats.json` file in its plugin data directory, storing the full list of cheat reports as an append-only array.

Each entry SHALL contain `cheaterUserId`, `questionId`, `reason`, optional `evidence`, and `detectedAt` (ISO 8601 timestamp).

#### Scenario: Cheat report is appended

- **WHEN** `save_cheating` records a report
- **THEN** the entry is appended to the existing `cheats.json` array
- **AND** previously recorded entries are preserved in original order

#### Scenario: First cheat creates the file

- **WHEN** `save_cheating` is invoked and `cheats.json` does not yet exist
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
