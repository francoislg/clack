## RENAMED Requirements

- FROM: `### Requirement: Hint button handler posts ephemeral and tracks clicks`
- TO: `### Requirement: Hint button handler opens a modal and tracks clicks`

## MODIFIED Requirements

### Requirement: Hint button handler opens a modal and tracks clicks

The Trivia plugin SHALL register a Slack action handler matching `plugin:trivia:hint:*` (where `*` is a question ID). On click, the handler SHALL:

1. Acknowledge the action immediately (`ack()`).
2. Parse the question ID from the action ID.
3. Resolve the game that owns the question and load the question record.
4. Open a **modal** via `client.views.open` using the `trigger_id` from the action body. The modal SHALL be display-only — it carries a Close button and NO submit button, so no `view_submission` event is produced and NO view handler is registered for it. When `record.hint` is present, the modal body SHALL contain the question statement alongside the hint text (`<localized "💡 Hint:"> <record.hint.text>`) so the clicker has context. The modal title SHALL come from a localized key.
5. If `record.hint` is ABSENT (stale message, edited record), the handler SHALL open a modal whose body is the localized "No hint available for this question" message instead. The handler SHALL NOT throw.
6. If the question's `hint.mode === "button"`, atomically update the question record to add the clicker's user ID to `hint.clickedBy`. The update SHALL dedupe — if the user is already in `clickedBy`, the array SHALL NOT be modified.
7. Repeat clicks from the same user SHALL open a fresh modal but SHALL NOT add a duplicate entry to `clickedBy`.

The handler SHALL NOT use `chat.postEphemeral` for any hint delivery. Ephemeral delivery is removed entirely.

If the action body lacks a `trigger_id`, or the Slack client is unavailable, the handler SHALL log a warning and return without throwing (no modal can be opened in that case).

Click tracking SHALL be BUTTON-MODE ONLY. The handler SHALL NOT update `clickedBy` when `record.hint?.mode === "inline"` (which never produces a button click in the first place, but defensively).

The handler SHALL NOT surface `clickedBy` data anywhere user-facing — no inclusion in reveal blocks, round summaries, leaderboard, or `submit_response` payloads. The field is internal analytics.

All modal strings SHALL go through `sdk.t()` with keys registered in the plugin's dictionary (EN source of truth, FR translation).

#### Scenario: First click — modal opened, user added to clickedBy

- **GIVEN** a question record `Q1` with `hint: { mode: "button", text: "Think about a primary color." }` and no `clickedBy`
- **WHEN** user `U123` clicks `plugin:trivia:hint:Q1`
- **THEN** the handler calls `ack()` first
- **AND** a modal is opened via `client.views.open` for `U123` containing the question text and `💡 <Hint:> Think about a primary color.`
- **AND** no `chat.postEphemeral` call is made
- **AND** `Q1.hint.clickedBy` on disk becomes `["U123"]`

#### Scenario: Repeat click from same user — fresh modal, no duplicate in clickedBy

- **GIVEN** `Q1.hint.clickedBy = ["U123"]` (from a prior click)
- **WHEN** user `U123` clicks the button a second time
- **THEN** another modal is opened for `U123`
- **AND** `Q1.hint.clickedBy` remains `["U123"]` (no duplicate added)

#### Scenario: Different user clicks — added to clickedBy

- **GIVEN** `Q1.hint.clickedBy = ["U123"]`
- **WHEN** user `U456` clicks the button
- **THEN** `Q1.hint.clickedBy` becomes `["U123", "U456"]` (or any order — set semantics)

#### Scenario: Missing hint — graceful fallback modal

- **GIVEN** a question record with no `hint` field (stale message)
- **WHEN** a user clicks `plugin:trivia:hint:<questionId>`
- **THEN** a modal is opened with the localized "No hint available for this question" message
- **AND** no error is thrown
- **AND** no `clickedBy` mutation is attempted

#### Scenario: Missing trigger_id — handler returns without throwing

- **GIVEN** an action body that lacks a `trigger_id`
- **WHEN** a user clicks `plugin:trivia:hint:<questionId>`
- **THEN** the handler logs a warning and returns
- **AND** no modal is opened and no error is thrown

#### Scenario: clickedBy not surfaced at reveal

- **GIVEN** `Q1.hint.clickedBy = ["U123", "U456"]`
- **WHEN** `process_reveal_answers` runs for `Q1`'s game
- **THEN** the reveal payload sent to Slack does NOT include `clickedBy` data
- **AND** the round summary does NOT mention hint usage
- **AND** scoring is computed identically to a question with no `hint` field

#### Scenario: Handler acknowledges within Slack's 3-second window

- **WHEN** a user clicks `plugin:trivia:hint:<questionId>`
- **THEN** the handler calls `ack()` before any other async work (modal open, question load, record update)
