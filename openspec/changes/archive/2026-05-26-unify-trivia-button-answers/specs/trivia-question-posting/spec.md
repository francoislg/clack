## MODIFIED Requirements

### Requirement: post_questions MCP Tool

The trivia plugin SHALL register an MCP tool named `post_questions` (admin role) that accepts a game name and an array of items — each item carrying a `questionId` and a `blocks` payload — and, for each item, posts the question to the game's configured Slack channel, retrieves the message's permalink, stamps `postedAt`, `messageLink`, and `liveAnswersVisible` on the question record, and appends an answer-buttons `actions` block sized to the question's `answersFormat`.

The tool's input schema SHALL be:

```ts
{
  game: string; // must match a writable entry in config.trivia.games[]
  items: Array<{
    questionId: string; // must exist in games/<game>/questions.json
    blocks: BlockKitBlocks; // Clack's curated Block Kit subset
  }>; // length >= 1
}
```

Channel resolution SHALL read `config.trivia.games[game].channel` at tool invocation time. The tool SHALL NOT accept a `channel` argument. The tool SHALL reject the call with a structured error when `config.trivia.games[game]` cannot be resolved or is disabled.

For each item, the tool SHALL append an `actions` block to the END of the item's `blocks` array (after Claude's authored content), sized and labeled per the question's stored `answersFormat`:

- `answersFormat === "boolean"` (or absent): two buttons, `{ text: "👍 TRUE", action_id: "plugin:trivia:vote:<questionId>:true", style: "primary" }` and `{ text: "👎 FALSE", action_id: "plugin:trivia:vote:<questionId>:false" }`, in that order.
- `answersFormat === "choice"`: 2–4 buttons sized to `question.choices.length`. Button `i` (0-indexed) SHALL have `text: "<numbered-emoji> <choices[i]>"` (numbered emoji is `1️⃣`, `2️⃣`, `3️⃣`, `4️⃣` for indices 0–3 respectively) and `action_id: "plugin:trivia:vote:<questionId>:<i>"`.
- `answersFormat === "freeform"`: one button, `{ text: "Answer", action_id: "plugin:trivia:freeform-answer:<questionId>", style: "primary" }`.

The tool SHALL NOT attach any reactions to the posted message. Vote reactions (`+1`/`-1`, `one`/`two`/`three`/`four`) SHALL NEVER be auto-attached. Users may still react manually; those reactions are consumed at reveal time as commentary only (see `trivia-reveal-processor`).

The tool SHALL NOT accept a `reactions` argument.

For each item, the tool SHALL resolve `liveAnswersVisible` from the cascade `slot.liveAnswersVisible → season.liveAnswersVisible → game.liveAnswersVisible → config.trivia.liveAnswersVisible → true (default)` and SHALL stamp the resolved boolean onto the question record alongside `postedAt`, `messageLink`, and `batchId`. The stamp SHALL happen in the same atomic `updateQuestion` write. Subsequent roster-footer rebuilds SHALL read this stamped value, not re-resolve the cascade.

For each item, the tool SHALL ALSO resolve `revealResponses` from the cascade `slot.revealResponses → season.revealResponses → game.revealResponses → config.trivia.revealResponses → "yes" (default)` and SHALL stamp the resolved value (`"no"` | `"just-correctness"` | `"yes"`) onto the question record in the same atomic `updateQuestion` write. Subsequent reveal-payload assembly inside `process_reveal_answers` SHALL read this stamped value, not re-resolve the cascade.

The tool SHALL stamp the full `blocks` array (with the appended `actions` block) onto the question record as `postedBlocks`, so that subsequent roster-footer rebuilds via `chat.update` can compose `[...postedBlocks, ...rosterBlocks]` from a stable base.

The tool's return shape SHALL be:

```ts
{
  results: Array<{
    questionId: string;
    ok: boolean;
    ts?: string; // present iff ok === true
    permalink?: string; // present iff ok === true
    error?: string; // present iff ok === false
  }>;
}
```

Each item SHALL be processed independently: a failure on one item SHALL NOT abort processing of the remaining items, and each item's outcome SHALL be reported in the corresponding `results` entry.

#### Scenario: Boolean question gets vote buttons, no reactions

- **GIVEN** `games/main/questions.json` contains `Q1` with `answersFormat: "boolean"` and no `postedAt`
- **WHEN** `post_questions({ game: "main", items: [{ questionId: "Q1", blocks: <valid> }] })` is called
- **THEN** the posted message includes an `actions` block as its final block with TWO buttons: `{ text: "👍 TRUE", action_id: "plugin:trivia:vote:Q1:true", style: "primary" }` followed by `{ text: "👎 FALSE", action_id: "plugin:trivia:vote:Q1:false" }`
- **AND** NO reactions are attached to the message
- **AND** the question record is stamped with `postedAt`, `messageLink`, `batchId`, `postedBlocks`, and `liveAnswersVisible`

#### Scenario: 4-choice question gets numbered-emoji buttons sized to choices

- **GIVEN** `games/main/questions.json` contains `Q2` with `answersFormat: "choice"` and `choices: ["The Beatles", "Led Zeppelin", "Cream", "The Who"]`
- **WHEN** `post_questions({ game: "main", items: [{ questionId: "Q2", blocks: <valid> }] })` is called
- **THEN** the posted message's final block is an `actions` block with FOUR buttons in order:
  - `{ text: "1️⃣ The Beatles", action_id: "plugin:trivia:vote:Q2:0" }`
  - `{ text: "2️⃣ Led Zeppelin", action_id: "plugin:trivia:vote:Q2:1" }`
  - `{ text: "3️⃣ Cream", action_id: "plugin:trivia:vote:Q2:2" }`
  - `{ text: "4️⃣ The Who", action_id: "plugin:trivia:vote:Q2:3" }`
- **AND** NO reactions are attached

#### Scenario: 3-choice question sizes buttons correctly

- **GIVEN** `Q3` with `answersFormat: "choice"` and `choices: ["A", "B", "C"]`
- **WHEN** `post_questions` posts `Q3`
- **THEN** the actions block contains exactly THREE buttons with action_ids `plugin:trivia:vote:Q3:0`, `plugin:trivia:vote:Q3:1`, `plugin:trivia:vote:Q3:2`

#### Scenario: Freeform question keeps its Answer button, no reactions

- **GIVEN** `Q4` with `answersFormat: "freeform"`
- **WHEN** `post_questions` posts `Q4`
- **THEN** the actions block contains one `{ text: "Answer", action_id: "plugin:trivia:freeform-answer:Q4", style: "primary" }` button
- **AND** NO reactions are attached

#### Scenario: liveAnswersVisible cascade resolved at post time

- **GIVEN** `config.trivia.liveAnswersVisible: true`, no game / season / slot override, and `Q1` belongs to the active batch
- **WHEN** `post_questions` posts `Q1`
- **THEN** the question record is updated with `liveAnswersVisible: true`

#### Scenario: liveAnswersVisible game-level override is honored

- **GIVEN** `config.trivia.liveAnswersVisible: true` and the game's config has `liveAnswersVisible: false`
- **WHEN** `post_questions` posts a question for that game
- **THEN** the question record is stamped `liveAnswersVisible: false`

#### Scenario: liveAnswersVisible slot-level override beats season and game

- **GIVEN** `config.trivia.liveAnswersVisible: true`, season override `false`, game override `true`, and the slot the question is being posted into has `liveAnswersVisible: false`
- **WHEN** `post_questions` posts the question
- **THEN** the question record is stamped `liveAnswersVisible: false` (slot wins the cascade)

#### Scenario: liveAnswersVisible defaults to true when nothing overrides

- **GIVEN** no `liveAnswersVisible` value is set at slot, season, game, or workspace config
- **WHEN** `post_questions` posts a question
- **THEN** the question record is stamped `liveAnswersVisible: true`

#### Scenario: Stamped value isolates against mid-round config edits

- **GIVEN** `Q1` was posted with stamped `liveAnswersVisible: true`
- **AND** an admin updates `config.trivia.liveAnswersVisible` to `false` AFTER the post
- **WHEN** a new answerer clicks a vote button on `Q1` and the roster footer rebuilds
- **THEN** the footer renders in the visible-answers layout (per the stamped `true`), NOT the hidden layout

#### Scenario: revealResponses cascade resolved at post time

- **GIVEN** `config.trivia.revealResponses: "yes"`, no game / season / slot override, and `Q1` belongs to the active batch
- **WHEN** `post_questions` posts `Q1`
- **THEN** the question record is updated with `revealResponses: "yes"`

#### Scenario: revealResponses game-level override is honored

- **GIVEN** `config.trivia.revealResponses: "yes"` and the game's config has `revealResponses: "just-correctness"`
- **WHEN** `post_questions` posts a question for that game
- **THEN** the question record is stamped `revealResponses: "just-correctness"`

#### Scenario: revealResponses slot-level override beats season and game

- **GIVEN** `config.trivia.revealResponses: "yes"`, season override `"just-correctness"`, game override `"yes"`, and the slot has `revealResponses: "no"`
- **WHEN** `post_questions` posts the question
- **THEN** the question record is stamped `revealResponses: "no"` (slot wins the cascade)

#### Scenario: revealResponses defaults to "yes" when nothing overrides

- **GIVEN** no `revealResponses` value is set at slot, season, game, or workspace config
- **WHEN** `post_questions` posts a question
- **THEN** the question record is stamped `revealResponses: "yes"`

#### Scenario: revealResponses stamped value isolates against mid-round config edits

- **GIVEN** `Q1` was posted with stamped `revealResponses: "no"`
- **AND** an admin updates `config.trivia.revealResponses` to `"yes"` AFTER the post
- **WHEN** `process_reveal_answers` runs for `Q1`'s batch
- **THEN** the reveal payload's `voters` for `Q1` carries `revealResponses: "no"` (per the stamped value), NOT the new live-config value

#### Scenario: postedBlocks is stamped for all formats

- **GIVEN** a question of any `answersFormat` is being posted
- **WHEN** `post_questions` completes the post
- **THEN** `question.postedBlocks` is set to the full Block Kit array (including the appended `actions` block)
- **AND** subsequent `chat.update` calls for the roster footer can compose against this base

## REMOVED Requirements

### Requirement: post_questions Stamps Atomically Before Reacting

**Reason**: Vote reactions are no longer auto-attached by `post_questions` for any format. The stamping-before-reacting ordering invariant is moot because there is no reaction-attachment step. Stamping happens once, atomically, alongside the post.

**Migration**: None required — callers continue to invoke `post_questions` the same way; the absence of reaction attachment is transparent.

### Requirement: Freeform Question Card Includes Answer Button

**Reason**: Folded into the modified `post_questions MCP Tool` requirement above, which now describes button-block attachment uniformly across all three answer formats (boolean, choice, freeform).

**Migration**: None required — the freeform Answer button behavior is preserved verbatim in the modified requirement; it is no longer split into its own requirement only because the same mechanism now serves all formats.

### Requirement: Freeform Questions Are Posted Without Reactions

**Reason**: All three formats are now posted without auto-attached reactions, not just freeform. The modified `post_questions MCP Tool` requirement above states this uniformly. A freeform-specific requirement is no longer informative.

**Migration**: None required — the no-reactions-on-freeform behavior is preserved (and extended to all formats); existing freeform code paths continue to operate.
