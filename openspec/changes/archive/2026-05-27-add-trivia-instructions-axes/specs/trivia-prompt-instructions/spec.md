## ADDED Requirements

### Requirement: `instructions` and `additionalInstructions` are optional string axes on every cascade tier

The trivia plugin SHALL define two parallel free-form-string axes named `instructions` and `additionalInstructions`. Each axis MAY be set at any of four tiers: workspace (on `TriviaConfig`), per-game (on `TriviaGame`), per-season (on `SeasonEntry`), and per-slot (on `SeasonFormatSlot`). Both axes are OPTIONAL at every tier; an absent or empty value at a tier MUST NOT contribute to the resolved output of that axis.

#### Scenario: All four tiers may carry independent values

- **WHEN** the trivia config sets `instructions: "Be funny."` at the workspace tier, the active game sets `instructions: "Be dry."`, the active season sets `instructions: "Halloween-themed."`, and the active slot sets `instructions: "Keep it short."`
- **THEN** the trivia plugin SHALL accept all four values without rejecting any tier

#### Scenario: Empty / whitespace-only values are treated as absent

- **WHEN** any tier sets `instructions` to `""` or `"   "`
- **THEN** the trivia plugin SHALL treat that tier as having no `instructions` value for cascade resolution purposes

### Requirement: `instructions` axis uses replace-cascade semantics

The `instructions` axis SHALL resolve using highest-precedence-wins semantics. The cascade order is `slot → season → game → workspace`. The first non-empty trimmed value encountered in that order is the resolved value. The resolver SHALL return `null` when every tier is empty or absent.

#### Scenario: Slot value wins over season, game, and workspace

- **WHEN** all four tiers carry distinct non-empty `instructions` values and an active slot is present
- **THEN** the resolved value SHALL be the slot's value, with the season, game, and workspace values discarded

#### Scenario: Season value wins when slot is absent

- **WHEN** the active slot does not set `instructions` (or no slot is active) and the season, game, and workspace tiers all set distinct values
- **THEN** the resolved value SHALL be the season's value

#### Scenario: Game value wins when slot and season are absent

- **WHEN** neither slot nor season sets `instructions` and both game and workspace set distinct values
- **THEN** the resolved value SHALL be the game's value

#### Scenario: Workspace value used as last resort

- **WHEN** slot, season, and game all lack `instructions` and the workspace sets a value
- **THEN** the resolved value SHALL be the workspace's value

#### Scenario: Resolver returns null when every tier is absent

- **WHEN** no tier sets `instructions`
- **THEN** the resolver SHALL return `null` and downstream tool payloads SHALL omit the `instructions` field entirely

### Requirement: `additionalInstructions` axis uses cumulative-cascade semantics

The `additionalInstructions` axis SHALL resolve by concatenating every non-empty tier's value in `workspace → game → season → slot` order (broadest first, narrowest last). Each non-empty segment SHALL be prefixed with a tier label and segments SHALL be separated by `\n\n`. The tier labels SHALL be `[Workspace]`, `[Game]`, `[Season]`, and `[Slot <index>]` where `<index>` is the zero-based numeric slot index. The resolver SHALL return `null` when every tier is empty or absent.

#### Scenario: All four tiers concatenate in cascade order

- **WHEN** workspace sets `"Avoid politics."`, game sets `"Be concise."`, season sets `"Halloween theme."`, and slot 2 sets `"Make it easy."`
- **THEN** the resolved value SHALL be exactly:
  ```
  [Workspace] Avoid politics.

  [Game] Be concise.

  [Season] Halloween theme.

  [Slot 2] Make it easy.
  ```

#### Scenario: Absent tiers are skipped

- **WHEN** workspace sets a value and slot sets a value, but game and season do not
- **THEN** the resolved value SHALL contain exactly the `[Workspace]` and `[Slot <index>]` segments joined by `\n\n` — no `[Game]` or `[Season]` label SHALL appear

#### Scenario: Slot label uses index, not the slot's `label` field

- **WHEN** slot 1 carries both an admin-set `label: "Quick fire"` display string and an `additionalInstructions` value
- **THEN** the resolved output SHALL prefix the slot segment with `[Slot 1]`, not `[Slot Quick fire]`

#### Scenario: Resolver returns null when every tier is absent

- **WHEN** no tier sets `additionalInstructions`
- **THEN** the resolver SHALL return `null` and downstream tool payloads SHALL omit the `additionalInstructions` field entirely

### Requirement: Resolver is pure and signature-aligned with sibling axes

The plugin SHALL expose pure functions `resolveInstructions(currentSeason, slotIndex, game, config)` and `resolveAdditionalInstructions(currentSeason, slotIndex, game, config)` under `src/plugins/trivia/domain/instructions.ts`. Both SHALL accept the same `(SeasonEntry | null, number | null, TriviaGame | null, TriviaConfig | null)` argument tuple as the existing `resolveContexts` resolver. Both SHALL be side-effect-free.

#### Scenario: Resolver accepts null arguments at every position

- **WHEN** called with `(null, null, null, null)`
- **THEN** the resolver SHALL return `null` (no tier carries data)

#### Scenario: slotIndex is honored only when format is active

- **WHEN** called with `slotIndex` set but the season has no `format` and the game has no `format`
- **THEN** the resolver SHALL ignore the slot tier (consistent with how `resolveContexts` handles the missing-format case)

### Requirement: Consumer contract — `get_ideas` surfaces both axes in its response payload

The `get_ideas` MCP tool SHALL call both resolvers and include `instructions` and `additionalInstructions` fields in its response payload alongside the existing `theme` field. The fields SHALL be present iff the corresponding resolver returns a non-null string; absent results SHALL omit the field entirely (NOT serialize as `null`). The question-generation prompt SHALL be instructed to honor both fields verbatim throughout the run when present.

#### Scenario: Both fields present in payload

- **WHEN** `get_ideas` resolves non-null values for both `instructions` and `additionalInstructions`
- **THEN** both keys SHALL appear in the response payload with their string values

#### Scenario: Only one field present in payload

- **WHEN** `get_ideas` resolves a non-null `instructions` but `additionalInstructions` is null
- **THEN** the response payload SHALL include `instructions` and SHALL NOT include any `additionalInstructions` key

#### Scenario: Neither field present in payload

- **WHEN** both resolvers return `null`
- **THEN** the response payload SHALL omit both keys entirely

### Requirement: Consumer contract — `process_reveal_answers` surfaces both axes in its response payload

The `process_reveal_answers` MCP tool SHALL call both resolvers against the active game, current season (if any), and the slot tier that corresponds to each reveal entry, and include `instructions` and `additionalInstructions` fields on the top-level `ProcessRevealResult`. The fields SHALL be present iff the corresponding resolver returns a non-null string; absent results SHALL omit the field entirely. The reveal prompt SHALL be instructed to honor both fields verbatim during reveal rendering when present.

#### Scenario: Both fields present on ProcessRevealResult

- **WHEN** `process_reveal_answers` runs with non-null resolved values for both axes
- **THEN** the returned `ProcessRevealResult` SHALL include both `instructions` and `additionalInstructions` string fields

#### Scenario: Fields omitted when resolvers return null

- **WHEN** every tier is absent for both axes
- **THEN** the returned `ProcessRevealResult` SHALL omit both keys entirely

### Requirement: Axes do NOT participate in other prompts

The `instructions` and `additionalInstructions` axes SHALL be surfaced ONLY via the `get_ideas` and `process_reveal_answers` MCP tool payloads. They SHALL NOT be injected into the bot-wide system prompt, trivia topic instructions, season-opener or season-finale prompts, the new-season ceremonial opener, or any other scheduled trivia prompt. Other scheduled prompts SHALL continue to operate identically to today's behavior.

#### Scenario: Season-finale prompt ignores the axes

- **WHEN** a season-finale fire happens and the season has `instructions` and `additionalInstructions` set
- **THEN** the finale prompt SHALL receive no `instructions` or `additionalInstructions` content (the finale prompt's contract is unchanged)

#### Scenario: Trivia topic instruction file is unchanged

- **WHEN** the trivia topic instructions are assembled
- **THEN** no content derived from `instructions` or `additionalInstructions` SHALL appear in the assembled topic instruction text
