## ADDED Requirements

### Requirement: `includeRevealInQuestions` axis resolves game → workspace → default

The trivia plugin SHALL support an `includeRevealInQuestions` setting with values `"yes" | "no"`, settable on a game (`TriviaGame.includeRevealInQuestions`) and on the workspace (`TriviaConfig.includeRevealInQuestions`). It SHALL be resolved by a dedicated resolver `resolveIncludeRevealInQuestions(game, workspace)` with the cascade `game → workspace → "no"`. There SHALL be NO season or slot tier and NO `CascadeAxes`/`AXIS_REGISTRY` membership — the resolver mirrors `resolveAllTimeRow`. The built-in default SHALL be `"no"`, so that with the axis unset at every tier the cards behave exactly as before this change (deterministic facts footer only; narrative lives in the summary). The parser SHALL reject any value other than the two literals with a field-scoped error and drop the offending value while preserving the entry.

#### Scenario: Game value wins over workspace

- **GIVEN** `game.includeRevealInQuestions === "yes"` and `workspace.includeRevealInQuestions === "no"`
- **WHEN** `resolveIncludeRevealInQuestions(game, workspace)` is called
- **THEN** it returns `"yes"`

#### Scenario: Default applies when unset

- **GIVEN** neither tier sets the axis
- **WHEN** `resolveIncludeRevealInQuestions(game, workspace)` is called
- **THEN** it returns `"no"`

#### Scenario: Invalid value rejected at parse time

- **WHEN** a game or workspace config supplies `includeRevealInQuestions: "maybe"`
- **THEN** the parser emits a field-scoped validation error and drops the value

### Requirement: `revealBlocks` field on the question record

The `TriviaQuestion` type SHALL gain an optional `revealBlocks?: KnownBlock[]` field holding Claude-authored reveal **commentary** blocks for that question's card (the WHY / fun-fact / "nobody cracked it" teaching) — never the deterministic Answer/Correct/Incorrect facts, which are always rendered from `answers.json` by `update_answers_block`. The field SHALL be absent when `includeRevealInQuestions` is `"no"` and for all legacy rows.

#### Scenario: Field is optional and absent by default

- **WHEN** a question is posted in a game resolving `"no"`
- **THEN** its record has no `revealBlocks` field

### Requirement: `update_question` persists authored reveal blocks

The trivia plugin SHALL register an `admin`-tier MCP tool `update_question` (callable as `mcp__trivia__update_question`) taking `{ game: string, questionId: string, revealBlocks: KnownBlock[] }`. The tool SHALL write `revealBlocks` onto the named question's record in `games/<game>/questions.json` and SHALL perform NO Slack write (consistent with `update_answers_block` being the sole card editor). The write SHALL be idempotent — re-calling replaces the stored blocks rather than appending. The tool SHALL reject the call (returning an error, writing nothing) when `resolveIncludeRevealInQuestions` for the question's game/workspace is `"no"`.

#### Scenario: Persists blocks when axis is yes

- **GIVEN** a game resolving `includeRevealInQuestions: "yes"`
- **WHEN** `update_question({ game, questionId: "Q1", revealBlocks: [<blocks>] })` is called
- **THEN** `Q1`'s record carries those `revealBlocks` and no Slack message is edited

#### Scenario: Re-calling overwrites

- **WHEN** `update_question` is called twice for the same question with different blocks
- **THEN** the record holds only the second call's blocks

#### Scenario: Rejected when axis is no

- **GIVEN** a game resolving `includeRevealInQuestions: "no"`
- **WHEN** `update_question({ game, questionId: "Q1", revealBlocks: [<blocks>] })` is called
- **THEN** the call returns an error and `Q1`'s record gains no `revealBlocks`

### Requirement: Card carries facts plus authored narrative when axis is yes

When a question's game resolves `includeRevealInQuestions: "yes"`, its revealed card SHALL show the deterministic results footer (Answer / Correct / Incorrect / counts per the question's `revealResponses`, rendered from `answers.json`) AND, beneath it, the question's stored `revealBlocks` narrative. When the game resolves `"no"`, the card SHALL show only the deterministic footer (today's behavior).

#### Scenario: Yes mode appends narrative under the facts

- **GIVEN** a question in a `"yes"`-mode game with stored `revealBlocks` and scored answers
- **WHEN** its card is projected at reveal
- **THEN** the card shows the deterministic footer AND the stored `revealBlocks` narrative directly below it
- **AND** the "See your answer" button remains the final actions block

#### Scenario: No mode card is facts-only

- **GIVEN** a question in a `"no"`-mode game
- **WHEN** its card is projected at reveal
- **THEN** the card shows only the deterministic footer, with no appended narrative
