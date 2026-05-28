# trivia-question-hints Specification

## Purpose

Support for optional question hints at four configuration tiers (workspace, per-game, per-season, per-slot) with two rendering modes (button-based or inline context blocks) and an optional difficulty threshold.

## Requirements

### Requirement: Hint axis on TriviaConfig, TriviaGame, SeasonEntry, and SeasonFormatSlot

The Trivia plugin's runtime configuration SHALL accept an optional `hint` axis at four tiers: workspace (`config.trivia.hint`), per-game (`config.trivia.games[i].hint`), per-season (`SeasonEntry.hint`), and per-slot (`SeasonFormatSlot.hint`). The axis SHALL have the shape:

```ts
type HintMode = "none" | "button" | "inline";
type DifficultyBucket = "easy" | "medium" | "hard";

interface TriviaHintConfig {
  mode: HintMode;
  minDifficulty?: DifficultyBucket; // when omitted, no difficulty threshold is applied
}
```

The parser SHALL validate `mode` against the three allowed values and SHALL validate `minDifficulty` against the three allowed bucket names. Invalid entries SHALL be dropped with a logged warning naming the tier and the violating field, matching the lenient drop-on-invalid policy used by the other cascading axes. When `mode === "none"`, the parser SHALL accept `minDifficulty` even though it has no runtime effect (storing it is a no-op the admin can use to "park" a threshold across enable/disable toggles).

#### Scenario: Valid hint config accepted at every tier

- **GIVEN** `config.trivia.hint = { mode: "button" }`
- **AND** `config.trivia.games[0].hint = { mode: "inline", minDifficulty: "medium" }`
- **WHEN** the config is loaded
- **THEN** both fields parse cleanly and are exposed on the parsed `TriviaConfig` and `TriviaGame` records exactly as written

#### Scenario: Invalid mode rejected

- **GIVEN** a config with `trivia.hint = { mode: "popup" }`
- **WHEN** the config is loaded
- **THEN** the `hint` field is dropped at that tier with a logged warning naming `popup` as not in `["none", "button", "inline"]`
- **AND** the cascade for the remaining tiers is unaffected

#### Scenario: Invalid minDifficulty rejected

- **GIVEN** a config with `trivia.games[0].hint = { mode: "button", minDifficulty: "trivial" }`
- **WHEN** the config is loaded
- **THEN** the `hint` field is dropped at that tier with a logged warning naming `trivial` as not in `["easy", "medium", "hard"]`

#### Scenario: Default fallthrough

- **GIVEN** no tier sets `hint`
- **WHEN** `resolveHintConfig(...)` is called for any slot/season/game combination
- **THEN** it returns `{ mode: "none" }` (the built-in default)

### Requirement: resolveHintConfig cascade ordering

The Trivia plugin SHALL provide a `resolveHintConfig(slotIndex, season, game, workspace)` helper that returns the first tier in the cascade order to supply a `hint` value, falling back to the built-in default `{ mode: "none" }`. Resolution SHALL use whole-object replace per tier (no field-level merging between tiers).

The cascade order SHALL be:

1. `season.format.questions[slotIndex].hint` (when `slotIndex !== null` and the slot exists)
2. `season.hint`
3. `game.hint`
4. `workspace.hint`
5. `{ mode: "none" }`

#### Scenario: Slot tier wins over season

- **GIVEN** `season.format.questions[2].hint = { mode: "button" }`
- **AND** `season.hint = { mode: "inline" }`
- **WHEN** `resolveHintConfig(2, season, game, workspace)` is called
- **THEN** the helper returns `{ mode: "button" }`

#### Scenario: Game tier wins when season absent

- **GIVEN** `season.hint` is absent
- **AND** `game.hint = { mode: "inline", minDifficulty: "hard" }`
- **AND** `workspace.hint = { mode: "button" }`
- **WHEN** `resolveHintConfig(null, season, game, workspace)` is called
- **THEN** the helper returns `{ mode: "inline", minDifficulty: "hard" }`

#### Scenario: Falls through to default when no tier set

- **WHEN** `resolveHintConfig(null, null, null, null)` is called
- **THEN** the helper returns `{ mode: "none" }`

### Requirement: minDifficulty filter applied at get_ideas time

The `get_ideas` tool SHALL, after rolling the question's difficulty bucket and resolving the hint config via `resolveHintConfig`, compute an `effectiveHintMode` value:

- When `resolved.mode === "none"`: `effectiveHintMode = "none"`.
- When `resolved.mode !== "none"` and `resolved.minDifficulty` is absent: `effectiveHintMode = resolved.mode`.
- When `resolved.mode !== "none"` and `resolved.minDifficulty` is set: `effectiveHintMode = resolved.mode` IFF the rolled difficulty bucket is at or above `resolved.minDifficulty` in the ordering `easy < medium < hard`; otherwise `effectiveHintMode = "none"`.

The `get_ideas` payload SHALL include `suggestedHintMode: "none" | "button" | "inline"` carrying the computed `effectiveHintMode`. When `suggestedHintMode !== "none"`, the payload SHALL ALSO include a `hintGuidance: string` field carrying constraints for Claude: write a single concise hint (≤140 chars) that nudges toward the answer WITHOUT stating or paraphrasing it, then self-review the draft and rewrite if it reveals too much.

#### Scenario: Threshold suppresses hint on easy question

- **GIVEN** the resolved hint config is `{ mode: "button", minDifficulty: "medium" }`
- **AND** `get_ideas` rolls `suggestedDifficulty: "Easy"`
- **WHEN** the payload is returned
- **THEN** `suggestedHintMode` is `"none"`
- **AND** `hintGuidance` is absent

#### Scenario: Threshold met — hint surfaced

- **GIVEN** the resolved hint config is `{ mode: "inline", minDifficulty: "medium" }`
- **AND** `get_ideas` rolls `suggestedDifficulty: "Medium"`
- **WHEN** the payload is returned
- **THEN** `suggestedHintMode` is `"inline"`
- **AND** `hintGuidance` is present

#### Scenario: No threshold configured — hint always surfaced when mode is non-none

- **GIVEN** the resolved hint config is `{ mode: "button" }` (no `minDifficulty`)
- **AND** `get_ideas` rolls `suggestedDifficulty: "Easy"`
- **WHEN** the payload is returned
- **THEN** `suggestedHintMode` is `"button"`
- **AND** `hintGuidance` is present

#### Scenario: Mode is none — no hint regardless of difficulty

- **GIVEN** the resolved hint config is `{ mode: "none" }`
- **WHEN** the payload is returned
- **THEN** `suggestedHintMode` is `"none"`
- **AND** `hintGuidance` is absent

### Requirement: Hint drafting with self-review in the question-generation prompt

The trivia plugin's question-generation prompt (`scheduledPrompts.ts`) SHALL include a hint-drafting step that fires AFTER the question + answer + explanation are settled but BEFORE `save_question` is called. The step SHALL be conditional on `suggestedHintMode !== "none"` and SHALL instruct Claude to:

1. Draft a hint (≤140 chars) that nudges toward the answer without stating it.
2. Self-review the draft: check whether it states the answer outright OR paraphrases it closely. If either, rewrite as a softer nudge that points to the semantic neighborhood without revealing the specific answer.
3. Pass the final hint to `save_question` as `hint: { mode: suggestedHintMode, text: "<final text>" }`.

The prompt SHALL include concrete examples of bad (answer-revealing) and good (semantically-adjacent) hints to anchor Claude's self-review. The prompt SHALL explicitly permit Claude to OMIT the hint entirely if no useful nudge exists for the question — better to ship no hint than a hint that gives away the answer.

The self-review SHALL run inside the same Claude session as the question generation. NO separate Claude session, judge call, or post-save validation pass is required by this requirement.

#### Scenario: Prompt includes hint step when suggestedHintMode is non-none

- **GIVEN** a question generation session where `get_ideas` returned `suggestedHintMode: "button"`
- **WHEN** the prompt is assembled
- **THEN** the prompt includes a hint-drafting step instructing Claude to draft + self-review + pass `hint` to `save_question`
- **AND** the step includes at least one bad-example and one good-example contrast

#### Scenario: Prompt omits hint step when suggestedHintMode is none

- **GIVEN** `get_ideas` returned `suggestedHintMode: "none"`
- **WHEN** the prompt is assembled
- **THEN** the prompt does NOT instruct Claude to draft a hint

#### Scenario: Claude may omit hint despite suggestion

- **GIVEN** the prompt instructs Claude to draft a hint
- **WHEN** Claude decides no useful nudge exists for the question
- **THEN** Claude calls `save_question` WITHOUT a `hint` field
- **AND** the call succeeds (see `save_question` validation requirement)

### Requirement: save_question accepts and persists hint

The `save_question` MCP tool SHALL accept an optional `hint` field of shape `{ mode: "button" | "inline"; text: string }`. Mode `"none"` SHALL be unrepresentable on input — to indicate no hint, the field MUST be omitted entirely.

Validation rules:

- When `hint` is provided: `mode` MUST be either `"button"` or `"inline"`; `text` MUST be a string that, after trimming, is non-empty and ≤140 characters. Failing values SHALL produce a structured error and reject the call.
- When `hint` is omitted: the question is stored without a hint. This SHALL be allowed even when `get_ideas` suggested a non-`"none"` mode (Claude may judge that no helpful hint exists).
- The validator SHALL NOT cross-check `hint.mode` against the cascade-resolved mode at validation time — Claude is the source of truth for what mode to stamp on the record, since the cascade is advisory and the stamp is what later drives rendering.

Persistence: the question record stored in `data/plugins/trivia/games/<game>/questions.json` SHALL gain an optional field `hint?: { mode: "button" | "inline"; text: string; clickedBy?: string[] }`. The `clickedBy` field SHALL be absent at save time (it is populated later by the hint button handler — see the click-tracking requirement). Existing records without the `hint` field SHALL load and post identically to today.

#### Scenario: Valid button hint accepted

- **WHEN** `save_question(..., hint: { mode: "button", text: "Think about a primary color." })` is called
- **THEN** the question record is written with `hint: { mode: "button", text: "Think about a primary color." }`
- **AND** `clickedBy` is absent on the persisted record

#### Scenario: Valid inline hint accepted

- **WHEN** `save_question(..., hint: { mode: "inline", text: "💡 a kind of fruit" })` is called
- **THEN** the question record is written with the trimmed text and `mode: "inline"`

#### Scenario: Empty text rejected

- **WHEN** `save_question(..., hint: { mode: "button", text: "   " })` is called
- **THEN** the call is rejected with a structured error referencing the non-empty constraint

#### Scenario: Over-140-char text rejected

- **GIVEN** `text` is 200 characters
- **WHEN** `save_question(..., hint: { ... })` is called
- **THEN** the call is rejected with a structured error naming the 140-char cap

#### Scenario: Hint omitted is allowed

- **GIVEN** `get_ideas` returned `suggestedHintMode: "button"`
- **WHEN** `save_question` is called WITHOUT a `hint` field
- **THEN** the call succeeds and the persisted record has no `hint` field

#### Scenario: Mode "none" rejected on save

- **WHEN** `save_question(..., hint: { mode: "none", text: "anything" })` is called
- **THEN** the call is rejected with a structured error stating `mode` must be `"button"` or `"inline"`

### Requirement: Hint button handler posts ephemeral and tracks clicks

The Trivia plugin SHALL register a Slack action handler matching `plugin:trivia:hint:*` (where `*` is a question ID). On click, the handler SHALL:

1. Acknowledge the action immediately (`ack()`).
2. Parse the question ID from the action ID.
3. Resolve the game from the channel via `resolveGameFromChannel(body.channel.id)`.
4. Load the question record. If `record.hint` is present, post an ephemeral message via `chat.postEphemeral` to the question's thread (`thread_ts: body.message.ts`, `user: body.user.id`) whose text is `<localized "💡 Hint:"> <record.hint.text>`. The ephemeral SHALL include the question text alongside the hint so the clicker has context (per the open-question default in the design).
5. If `record.hint` is ABSENT (stale message, edited record), post an ephemeral with the localized "No hint available for this question" message instead. The handler SHALL NOT throw.
6. If the question's `hint.mode === "button"`, atomically update the question record to add the clicker's user ID to `hint.clickedBy`. The update SHALL dedupe — if the user is already in `clickedBy`, the array SHALL NOT be modified.
7. Repeat clicks from the same user SHALL fire a fresh ephemeral message (Slack's natural behavior — `postEphemeral` is not editable/dedupable) but SHALL NOT add a duplicate entry to `clickedBy`.

Click tracking SHALL be BUTTON-MODE ONLY. The handler SHALL NOT update `clickedBy` when `record.hint?.mode === "inline"` (which never produces a button click in the first place, but defensively).

The handler SHALL NOT surface `clickedBy` data anywhere user-facing — no inclusion in reveal blocks, round summaries, leaderboard, or `submit_response` payloads. The field is internal analytics.

All ephemeral-message strings SHALL go through `sdk.t()` with keys registered in the plugin's dictionary (EN source of truth, FR translation).

#### Scenario: First click — ephemeral posted, user added to clickedBy

- **GIVEN** a question record `Q1` with `hint: { mode: "button", text: "Think about a primary color." }` and no `clickedBy`
- **WHEN** user `U123` clicks `plugin:trivia:hint:Q1`
- **THEN** the handler calls `ack()` first
- **AND** an ephemeral message is posted to the question's thread, visible to `U123`, containing the question text and `💡 <Hint:> Think about a primary color.`
- **AND** `Q1.hint.clickedBy` on disk becomes `["U123"]`

#### Scenario: Repeat click from same user — fresh ephemeral, no duplicate in clickedBy

- **GIVEN** `Q1.hint.clickedBy = ["U123"]` (from a prior click)
- **WHEN** user `U123` clicks the button a second time
- **THEN** another ephemeral is posted to the thread visible to `U123` (Slack's natural behavior)
- **AND** `Q1.hint.clickedBy` remains `["U123"]` (no duplicate added)

#### Scenario: Different user clicks — added to clickedBy

- **GIVEN** `Q1.hint.clickedBy = ["U123"]`
- **WHEN** user `U456` clicks the button
- **THEN** `Q1.hint.clickedBy` becomes `["U123", "U456"]` (or any order — set semantics)

#### Scenario: Missing hint — graceful fallback ephemeral

- **GIVEN** a question record with no `hint` field (stale message)
- **WHEN** a user clicks `plugin:trivia:hint:<questionId>`
- **THEN** an ephemeral is posted with the localized "No hint available for this question" message
- **AND** no error is thrown
- **AND** no `clickedBy` mutation is attempted

#### Scenario: clickedBy not surfaced at reveal

- **GIVEN** `Q1.hint.clickedBy = ["U123", "U456"]`
- **WHEN** `process_reveal_answers` runs for `Q1`'s game
- **THEN** the reveal payload sent to Slack does NOT include `clickedBy` data
- **AND** the round summary does NOT mention hint usage
- **AND** scoring is computed identically to a question with no `hint` field

#### Scenario: Handler acknowledges within Slack's 3-second window

- **WHEN** a user clicks `plugin:trivia:hint:<questionId>`
- **THEN** the handler calls `ack()` before any other async work (ephemeral post, question load, record update)
