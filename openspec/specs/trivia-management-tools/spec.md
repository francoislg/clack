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
- When the admin explicitly asks, the path is: `compute_answers` in reprocess mode targeting that batch (`reprocessBatchId`, or `reprocessQuestionIds`), then `update_answers_block` with the returned `batchId`. Reprocessing re-stamps the current `revealResponses` / `judgeLeniency` and (for freeform) re-judges the retained answers.
- The reveal cron SHALL NOT be re-run via `run_scheduled_message_now` to apply a config change to a posted batch.
- A change to a posted batch SHALL NOT be reported as done unless it was actually reprocessed (no claiming an effect the tools did not produce).

#### Scenario: Instruction documents the reprocess path and prohibitions

- **WHEN** the assembled `TRIVIA_MANAGEMENT_INSTRUCTION` is inspected
- **THEN** it contains a section on correcting an already-posted batch that names the `compute_answers` reprocess → `update_answers_block` flow
- **AND** it states that config edits only affect future batches
- **AND** it prohibits using `run_scheduled_message_now` to apply a config change to a posted batch
- **AND** it instructs not to claim a posted batch changed unless it was reprocessed

#### Scenario: Instruction gates reprocessing to explicit admin requests only

- **WHEN** the assembled `TRIVIA_MANAGEMENT_INSTRUCTION` is inspected
- **THEN** it states reprocessing a posted batch is a separate, explicit, admin-initiated action
- **AND** it forbids reprocessing automatically or as a follow-up to a plain config edit

