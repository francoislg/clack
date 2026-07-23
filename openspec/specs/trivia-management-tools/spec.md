# trivia-management-tools Specification

## Purpose
Gated admin tools for managing trivia games and seasons, made available only when the `trivia:management` integration is attached.
## Requirements
### Requirement: `trivia:management` integration is plugin-declared

The trivia plugin SHALL declare the `trivia:management` integration at load time via `sdk.registerIntegration("trivia:management", { description, alwaysLoad: false })`. The description SHALL enumerate every gated tool by name: `upsert_game`, `delete_game`, `set_workspace_config`, `upsert_season`, `delete_season`, `add_categories`, and `remove_categories`. The integration SHALL NOT appear in `data/config.json` `mcpServers`.

#### Scenario: Plugin declares the integration at load time
- **WHEN** the trivia plugin loads
- **THEN** it calls `sdk.registerIntegration("trivia:management", { description: "...", alwaysLoad: false })`
- **AND** `data/config.json` `mcpServers` does NOT contain a `trivia:management` (or `trivia_management`) entry

#### Scenario: Integration surfaces in the integrations list shown to Claude
- **WHEN** a new admin query session starts
- **AND** the system assembles the integrations catalog for the system prompt
- **THEN** the `trivia:management` entry appears in the catalog with the plugin-declared description
- **AND** Claude can call `attach_integration({ name: "trivia:management" })` and the call validates

#### Scenario: Description enumerates all seven tools
- **WHEN** the trivia plugin's `registerIntegration` call is inspected
- **THEN** the `description` string mentions `upsert_game`, `delete_game`, `set_workspace_config`, `upsert_season`, `delete_season`, `add_categories`, and `remove_categories` by name

### Requirement: Topic-gated admin instruction

The system SHALL register the `trivia:management` admin instruction as topic-scoped, not baseline. The instruction file SHALL be keyed under the `trivia:management` topic so it loads only when the topic is active for the session.

#### Scenario: Instruction is registered via `addTopicInstruction`
- **WHEN** the trivia plugin loads
- **THEN** the management instruction is registered via `sdk.addTopicInstruction("admin", "trivia:management", "trivia-management", ...)`
- **AND** the instruction is NOT registered via `sdk.addInstruction`

#### Scenario: Instruction loads only when topic is attached
- **GIVEN** an admin session that has NOT called `attach_integration("trivia:management")`
- **WHEN** the system assembles the admin's system prompt
- **THEN** the `trivia:management` instruction content is absent from the assembled prompt

#### Scenario: Instruction loads after attach
- **GIVEN** an admin session that has called `attach_integration("trivia:management")`
- **WHEN** the system assembles the admin's instruction set for the next turn
- **THEN** the `trivia:management` topic instruction content is present
- **AND** the resolved override path is `data/configuration/admin/topics/trivia:management/trivia__trivia-management.md`

### Requirement: Topic-gated tool registration for management tools

The system SHALL register the seven config-mutation tools under the `trivia:management` topic so they are hidden from the assembled tool catalog when the topic is not attached. The seven tools are: `upsert_game`, `delete_game`, `set_workspace_config`, `upsert_season`, `delete_season`, `add_categories`, `remove_categories`.

#### Scenario: Tools are registered with the topic gate
- **WHEN** the trivia plugin loads
- **THEN** each of the seven config-mutation tools is registered via `sdk.registerTool("admin", ..., { integration: "trivia:management" })`
- **AND** none of the seven omits the `{ integration: "trivia:management" }` options object

#### Scenario: Tools hidden from admin without attach
- **GIVEN** an admin session that has NOT called `attach_integration("trivia:management")`
- **WHEN** the tool server assembles the admin's tool catalog for the next turn
- **THEN** none of the seven management tools appear in the catalog
- **AND** the runtime tools (`get_ideas`, `save_question`, `post_questions`, `get_question_history`, `submit_answers`, `process_reveal_answers`, `check_season_status`, `save_cheating`) and read-only tools (`list_games`, `list_seasons`, `find_previous_questions`, `retrieve_scores`) ARE present (they are not topic-gated)

#### Scenario: Tools visible to admin after attach
- **GIVEN** an admin session that has called `attach_integration("trivia:management")`
- **WHEN** the tool server assembles the admin's tool catalog for the next turn
- **THEN** all seven management tools appear in the catalog

#### Scenario: Tools hidden from non-admin even after attach
- **GIVEN** a `dev`-role session that has called `attach_integration("trivia:management")`
- **WHEN** the tool server assembles the catalog
- **THEN** none of the seven management tools appear (the role gate still applies on top of the topic gate)

#### Scenario: Cron-fired runtime sessions never see management tools
- **GIVEN** a scheduled trivia session fired by a cron job
- **WHEN** the tool server assembles the catalog
- **THEN** none of the seven management tools appear (the cron-fired session does not attach `trivia:management`)
- **AND** the runtime tools required to post and reveal questions ARE present

### Requirement: Management instruction enumerates all seven tools and includes dispatch heuristic

The body of the `trivia:management` admin instruction SHALL document all seven config-mutation tools (not three) and SHALL include an explicit dispatch heuristic that disambiguates between game-tier and season-tier operations.

#### Scenario: Instruction body lists every gated tool
- **WHEN** the system loads the topic-scoped instruction file
- **THEN** the rendered content mentions `upsert_game`, `delete_game`, `set_workspace_config`, `upsert_season`, `delete_season`, `add_categories`, and `remove_categories` by name

#### Scenario: Instruction body includes dispatch heuristic
- **WHEN** an admin says "update the game config for X" (no season slug named)
- **THEN** the instruction directs Claude to prefer `upsert_game` over `upsert_season`
- **WHEN** an admin says "update the season X" or names a season slug
- **THEN** the instruction directs Claude to prefer `upsert_season` over `upsert_game`

### Requirement: Management instruction covers correcting an already-posted batch

The `TRIVIA_MANAGEMENT_INSTRUCTION` SHALL include guidance for applying a config change to an ALREADY-POSTED batch. The guidance SHALL state that:

- Config edits via `upsert_game` / `upsert_season` / `set_workspace_config` (including `revealResponses` and `judgeLeniency`) take effect for FUTURE batches only — they do NOT retroactively change a batch that is already posted, and that is the default, intended behavior.
- Reprocessing an already-posted batch is a SEPARATE, EXPLICIT, admin-initiated action. The instruction SHALL direct Claude to reprocess ONLY when the admin explicitly asks to update/fix/re-apply something to already-posted questions, and SHALL forbid reprocessing automatically, as a follow-up to a plain config edit, or on Claude's own initiative. After a normal config edit Claude SHALL NOT reprocess — at most it may note the change affects future batches and offer to update the posted batch.
- When the admin explicitly asks, the path is: `compute_answers` in reprocess mode targeting that batch (`reprocessBatchId`, or `reprocessQuestionIds`), then `refresh_question_cards` with the returned `batchId`. Reprocessing re-stamps the current `revealResponses` / `judgeLeniency` and (for freeform) re-judges the retained answers.
- The reveal cron SHALL NOT be re-run via `run_scheduled_message_now` to apply a config change to a posted batch.
- A change to a posted batch SHALL NOT be reported as done unless it was actually reprocessed (no claiming an effect the tools did not produce).

#### Scenario: Instruction documents the reprocess path and prohibitions

- **WHEN** the assembled `TRIVIA_MANAGEMENT_INSTRUCTION` is inspected
- **THEN** it contains a section on correcting an already-posted batch that names the `compute_answers` reprocess → `refresh_question_cards` flow
- **AND** it states that config edits only affect future batches
- **AND** it prohibits using `run_scheduled_message_now` to apply a config change to a posted batch
- **AND** it instructs not to claim a posted batch changed unless it was reprocessed

#### Scenario: Instruction gates reprocessing to explicit admin requests only

- **WHEN** the assembled `TRIVIA_MANAGEMENT_INSTRUCTION` is inspected
- **THEN** it states reprocessing a posted batch is a separate, explicit, admin-initiated action
- **AND** it forbids reprocessing automatically or as a follow-up to a plain config edit

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

### Requirement: Admin tools accept and surface answeringType

`upsert_game`, `upsert_season`, and `set_workspace_config` SHALL accept `answeringType: "individual" | "byTeam" | null` with the standard omit-to-keep / null-to-clear semantics and shadowing detection. `list_games` and `list_seasons` SHALL surface the field present-iff-set, and `list_games` SHALL emit a warning when the resolved `answeringType` is `"byTeam"` but inert (teams disabled or empty roster), plus a divergence note when live byTeam questions carry a stamp differing from current config.

#### Scenario: Setting byTeam on a game

- **WHEN** an admin runs `upsert_game` with `answeringType: "byTeam"` on a game whose teams config is enabled with a roster
- **THEN** the field persists at the game tier and subsequent `post_questions` fires stamp `"byTeam"`

#### Scenario: Inert warning surfaces

- **WHEN** `list_games` runs for a game resolving `answeringType: "byTeam"` with an empty effective roster
- **THEN** the entry carries a warning naming the inert `answeringType` and the missing precondition

#### Scenario: Clearing answeringType with null

- **WHEN** an admin runs `upsert_game` with `answeringType: null` on a game where it was previously `"byTeam"`
- **THEN** the game-tier field is removed, subsequent `post_questions` fires resolve `answeringType` from the remaining tiers (or the `"individual"` default), and `list_games` no longer surfaces the field for that game

#### Scenario: Shadowing detection on a masked write

- **WHEN** an admin sets `answeringType` at the game tier while the active season already sets `answeringType`
- **THEN** `upsert_game` persists the game value and returns a `shadowedBy` note stating the season tier masks it, per the existing shadowing-detection mechanism

