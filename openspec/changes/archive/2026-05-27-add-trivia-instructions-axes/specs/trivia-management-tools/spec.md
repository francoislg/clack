## ADDED Requirements

### Requirement: `set_workspace_config` accepts both new axes

The `set_workspace_config` MCP tool SHALL accept two new optional arguments: `instructions: z.string().nullable().optional()` and `additionalInstructions: z.string().nullable().optional()`. Both SHALL follow the same null-to-clear / omit-to-keep semantics as the existing `liveAnswersVisible` and `revealResponses` workspace-tier args. Passed strings SHALL be trimmed; empty / whitespace-only strings SHALL be rejected with a clear error (unlike the file-load path's lenient drop policy, MCP-tool input is strict).

#### Scenario: Set both fields at workspace tier

- **WHEN** an admin calls `set_workspace_config({ instructions: "Be funny.", additionalInstructions: "Avoid politics." })`
- **THEN** both fields SHALL be persisted to `data/plugins/trivia/config.json` and the in-memory config SHALL reflect them on the next read

#### Scenario: Clear a workspace-tier field via null

- **WHEN** an admin calls `set_workspace_config({ instructions: null })`
- **THEN** the `instructions` key SHALL be removed from the persisted workspace config; `additionalInstructions` SHALL be unaffected

#### Scenario: Omit-to-keep semantics on update

- **WHEN** `instructions` was previously set to `"Be funny."` and an admin calls `set_workspace_config({ additionalInstructions: "Avoid politics." })` without passing `instructions`
- **THEN** `instructions` SHALL retain its prior `"Be funny."` value AND `additionalInstructions` SHALL be set

#### Scenario: Empty string is rejected

- **WHEN** an admin calls `set_workspace_config({ instructions: "" })` or `set_workspace_config({ instructions: "   " })`
- **THEN** the tool SHALL return an error result describing the empty-string rejection AND SHALL NOT mutate the config file

### Requirement: `upsert_game` accepts both new axes

The `upsert_game` MCP tool SHALL accept `instructions` and `additionalInstructions` arguments mirroring the existing `theme` field's shape (`z.string().nullable().optional()`). On CREATE the values are stored on the new game entry; on UPDATE, `null` clears the field, omit retains the existing value, and a non-empty string updates the field. Empty / whitespace-only strings SHALL be rejected with a clear error.

#### Scenario: CREATE with both fields

- **WHEN** an admin upserts a new game with `instructions` and `additionalInstructions` both set
- **THEN** both fields SHALL be stored on the new `TriviaGame` entry

#### Scenario: UPDATE clears one field via null

- **WHEN** an existing game has both fields set AND an admin calls `upsert_game({ name: "main", instructions: null })`
- **THEN** the `instructions` field SHALL be cleared on the persisted entry; `additionalInstructions` SHALL be unaffected

#### Scenario: UPDATE response payload signals presence

- **WHEN** `upsert_game` completes
- **THEN** the response payload SHALL include `hasInstructions: boolean` and `hasAdditionalInstructions: boolean` summary booleans alongside the existing `hasTheme` field

### Requirement: `upsert_season` accepts both new axes

The `upsert_season` MCP tool SHALL accept `instructions` and `additionalInstructions` arguments mirroring the existing `theme` field's shape (`z.string().nullable().optional()`). CREATE / UPDATE semantics match `theme` exactly — including mid-season mutation permission. Empty / whitespace-only strings SHALL be rejected with a clear error.

#### Scenario: CREATE season with both fields

- **WHEN** an admin upserts a new season with both fields set
- **THEN** both fields SHALL be persisted on the new `SeasonEntry`

#### Scenario: UPDATE mid-season

- **WHEN** an admin updates `additionalInstructions` on a season that is already active (has stamped questions)
- **THEN** the update SHALL succeed (same mid-season mutation policy as the other narrative axes)

#### Scenario: UPDATE response payload signals presence

- **WHEN** `upsert_season` completes
- **THEN** the response payload SHALL include `hasInstructions: boolean` and `hasAdditionalInstructions: boolean` summary booleans

### Requirement: `list_games` surfaces both fields under the present-iff-set rule

The `list_games` MCP tool's per-game entry SHALL include optional `instructions` and `additionalInstructions` fields. Each field SHALL be present iff the game's persisted config explicitly set it; absent if not set. Workspace-tier values SHALL also be surfaced in `list_games`' workspace-level section (wherever `theme` / `liveAnswersVisible` / `revealResponses` workspace defaults already appear).

#### Scenario: Game with one field set

- **WHEN** a game has `instructions` set but not `additionalInstructions`
- **THEN** that game's entry in `list_games`' output SHALL include `instructions` but SHALL NOT include `additionalInstructions`

#### Scenario: Game with neither field set

- **WHEN** a game has neither field set
- **THEN** that game's entry SHALL omit both fields entirely

### Requirement: `list_seasons` surfaces both fields under the present-iff-set rule, including slot level

The `list_seasons` MCP tool SHALL surface both fields at the season tier AND on each slot in the season's `format.questions[]` array, using the present-iff-set rule.

#### Scenario: Season with both fields set

- **WHEN** a season has both fields set
- **THEN** the season entry in `list_seasons`' output SHALL include both fields

#### Scenario: Slot with one field set

- **WHEN** slot 2 of a season carries `additionalInstructions` but not `instructions`
- **THEN** the slot entry in `list_seasons`' output SHALL include `additionalInstructions` and SHALL NOT include `instructions`
