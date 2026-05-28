## MODIFIED Requirements

### Requirement: post_questions MCP Tool

The trivia plugin SHALL register an MCP tool named `post_questions` (admin role) that accepts a game name and an array of items — each item carrying a `questionId` and a `blocks` payload — and, for each item, posts the question to the game's configured Slack channel, retrieves the message's permalink, stamps `postedAt`, `messageLink`, and `liveAnswersVisible` on the question record, and appends an answer-buttons `actions` block sized to the question's `answersFormat`. When the persisted question record carries a `hint` field, the tool SHALL ALSO surface the hint at post time per the hint mode (see Hint rendering below).

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

**Hint rendering.** When the question record has a `hint` field, the tool SHALL surface the hint based on `hint.mode`:

- `hint.mode === "button"`: append an additional button to the SAME `actions` block (placed AFTER the answer buttons) with `text: <localized "💡 Get Hint!">`, `action_id: "plugin:trivia:hint:<questionId>"`, and NO `style` field (the hint button is secondary, distinct from the primary answer buttons). The button label SHALL be sourced via the plugin's `sdk.t()` dictionary for the question's language.
- `hint.mode === "inline"`: prepend a Block Kit `context` block IMMEDIATELY BEFORE the answer-buttons `actions` block whose text is `💡 _<localized "Hint:">_ <hint.text>`. The italicized label SHALL come through `sdk.t()`.

When the question record has no `hint` field, posting SHALL be byte-for-byte identical to the pre-change behavior — no hint button, no context block.

The tool SHALL NOT attach any reactions to the posted message. Vote reactions (`+1`/`-1`, `one`/`two`/`three`/`four`) SHALL NEVER be auto-attached. Users may still react manually; those reactions are consumed at reveal time as commentary only (see `trivia-reveal-processor`).

The tool SHALL NOT accept a `reactions` argument.

For each item, the tool SHALL resolve `liveAnswersVisible` from the cascade `slot.liveAnswersVisible → season.liveAnswersVisible → game.liveAnswersVisible → config.trivia.liveAnswersVisible → true (default)` and SHALL stamp the resolved boolean onto the question record alongside `postedAt`, `messageLink`, and `batchId`. The stamp SHALL happen in the same atomic `updateQuestion` write. Subsequent roster-footer rebuilds SHALL read this stamped value, not re-resolve the cascade.

For each item, the tool SHALL ALSO resolve `revealResponses` from the cascade `slot.revealResponses → season.revealResponses → game.revealResponses → config.trivia.revealResponses → "yes" (default)` and SHALL stamp the resolved value (`"no"` | `"just-correctness"` | `"yes"`) onto the question record in the same atomic `updateQuestion` write. Subsequent reveal-payload assembly inside `process_reveal_answers` SHALL read this stamped value, not re-resolve the cascade.

The tool SHALL stamp the full `blocks` array (with the prepended hint context block when applicable, AND the appended `actions` block including the hint button when applicable) onto the question record as `postedBlocks`, so that subsequent roster-footer rebuilds via `chat.update` can compose `[...postedBlocks, ...rosterBlocks]` from a stable base.

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

#### Scenario: Hint button appended after answer buttons in boolean question

- **GIVEN** a question record with `answersFormat: "boolean"` and `hint: { mode: "button", text: "..." }`
- **WHEN** `post_questions` posts the item
- **THEN** the posted `actions` block contains THREE buttons in order: 👍 TRUE, 👎 FALSE, "💡 Get Hint!"
- **AND** the "💡 Get Hint!" button has `action_id: "plugin:trivia:hint:<questionId>"`
- **AND** the "💡 Get Hint!" button has no `style` field (renders as Slack's default secondary style)

#### Scenario: Hint button appended after answer buttons in choice question

- **GIVEN** a question record with `answersFormat: "choice"`, four choices, and `hint: { mode: "button", text: "..." }`
- **WHEN** `post_questions` posts the item
- **THEN** the posted `actions` block contains FIVE buttons in order: 1️⃣, 2️⃣, 3️⃣, 4️⃣, "💡 Get Hint!"

#### Scenario: Inline hint context block precedes the answer-buttons actions block

- **GIVEN** a question record with `hint: { mode: "inline", text: "Think about a primary color." }`
- **WHEN** `post_questions` posts the item
- **THEN** the posted message blocks are, in order: [...Claude-authored blocks], context block containing `💡 _Hint:_ Think about a primary color.`, actions block with the answer buttons (no hint button)

#### Scenario: No hint on record — posting unchanged

- **GIVEN** a question record with no `hint` field
- **WHEN** `post_questions` posts the item
- **THEN** the posted blocks are exactly `[...Claude-authored blocks, answer-buttons actions block]` with no extra context block and no hint button

#### Scenario: postedBlocks snapshot includes hint elements

- **GIVEN** a question record with `hint: { mode: "button", text: "..." }`
- **WHEN** `post_questions` posts the item
- **THEN** the stamped `postedBlocks` on the question record includes the hint button as the last button in the actions block
- **AND** a subsequent roster-footer rebuild via `chat.update` composes `[...postedBlocks, ...rosterBlocks]` and the hint button persists in the rebuilt message
