# trivia-management-tools Delta

## ADDED Requirements

### Requirement: Upsert tools accept the four teams fields

`upsert_game`, `upsert_season`, and `set_workspace_config` SHALL accept `teams`, `teamsEnabled`, `teamsFinaleIndividuals`, and `teamsScoring` at their respective tiers with the standard semantics: omit keeps the existing value, explicit `null` clears the field from that tier, and a provided value is validated (roster validation per trivia-teams; `teamsScoring` must be a registered mode) then replaces. Writing `teamsEnabled: true` without a roster at that tier SHALL be accepted as valid staging (the roster may live at, or later arrive at, another tier); the empty-effective-roster check is a RUNTIME gate surfaced as a `list_games` warning, never a write-time rejection. Shadowing detection SHALL cover the teams fields, so a game-tier write masked by a season-tier value returns `shadowedBy`.

#### Scenario: Set roster and enable on the current season

- **WHEN** an admin runs `upsert_season` with `teams: [{ name: "Red", userIds: [...] }, ...]` and `teamsEnabled: true`
- **THEN** the season plays in teams mode and reverts to individual play automatically when it ends

#### Scenario: Null clears one field without touching siblings

- **WHEN** an admin runs `upsert_game` with `teamsEnabled: null` and omits `teams`
- **THEN** the game-tier enablement is removed while the game-tier roster is kept

#### Scenario: Invalid scoring mode rejected

- **WHEN** `teamsScoring: "winner-takes-all"` is passed and no such registry mode exists
- **THEN** the write fails naming the valid modes

#### Scenario: Shadowed game-tier roster surfaced

- **WHEN** an admin writes a game-tier roster while the active season has its own roster
- **THEN** the result includes `shadowedBy: { tier: "season", ... }` listing `teams`

### Requirement: retrieve_scores includes team standings when teams mode is on

`retrieve_scores` SHALL continue to serve the individual leaderboard unchanged in every mode, and SHALL additionally include team standings (computed via the resolved scoring strategy) when the game's effective teams mode is ON.

#### Scenario: Team standings alongside individuals

- **WHEN** `retrieve_scores` runs for a game whose effective `teamsEnabled` is `true` with a non-empty roster
- **THEN** the result carries team standings in addition to the unchanged individual leaderboard

#### Scenario: No team fields when off

- **WHEN** `retrieve_scores` runs with teams mode off
- **THEN** the result is identical to pre-feature behavior

### Requirement: List tools project teams fields present-iff-set

`list_games` SHALL surface the teams fields per game and under `workspaceDefaults`, and `list_seasons` per season, only when set at that tier (no null placeholders). When effective `teamsEnabled` is `true` but the effective roster is empty, `list_games` SHALL include a misconfiguration warning for that game.

#### Scenario: Projection shows only set tiers

- **WHEN** only the workspace defines `teams` and a season defines `teamsEnabled`
- **THEN** `list_games` shows `teams` under `workspaceDefaults` only, and `list_seasons` shows `teamsEnabled` on that season only

#### Scenario: Empty-roster warning

- **WHEN** effective `teamsEnabled` is `true` with an empty effective roster
- **THEN** the game's `list_games` entry carries a warning that teams mode is inert
