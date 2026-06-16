## ADDED Requirements

### Requirement: Scroll-to-top knob cascades game over workspace

The system SHALL provide an optional boolean `scrollToTop` knob settable at the per-game (`TriviaGame`) and workspace (`TriviaConfig`) tiers, resolved by a dedicated `resolveScrollToTop(game, workspace)` function with the order game → workspace → built-in default `false`. It SHALL NOT be a `CascadeAxes` member and SHALL NOT have a slot or season tier.

#### Scenario: Game tier wins

- **WHEN** a game sets `scrollToTop: true` and the workspace sets `scrollToTop: false`
- **THEN** `resolveScrollToTop` returns `true` for that game

#### Scenario: Falls back to workspace

- **WHEN** a game does not set `scrollToTop` and the workspace sets `scrollToTop: true`
- **THEN** `resolveScrollToTop` returns `true`

#### Scenario: Built-in default is off

- **WHEN** neither the game nor the workspace sets `scrollToTop`
- **THEN** `resolveScrollToTop` returns `false`

### Requirement: Trailing scroll-to-top message on multi-question batches

When `scrollToTop` resolves to `true` and a `post_questions` fire posts 2 or more question messages in the batch, the system SHALL post exactly one additional top-level channel message after the questions, in the game's channel, containing a single mrkdwn link labelled with a scroll glyph and a localized "scroll to the first question" label pointing at the batch's first question message. The trailing message SHALL be posted with link and media unfurls suppressed. The system SHALL NOT post the trailing message when fewer than 2 question messages exist in the batch, nor when `scrollToTop` resolves to `false`.

#### Scenario: Posts trailing link for a multi-question batch

- **WHEN** `scrollToTop` is enabled and `post_questions` posts 3 questions
- **THEN** a fourth top-level message is posted to the same channel linking to the first question's message, with unfurls suppressed

#### Scenario: Skips trailing link for a single-question batch

- **WHEN** `scrollToTop` is enabled and `post_questions` posts exactly 1 question
- **THEN** no trailing message is posted

#### Scenario: Disabled by default

- **WHEN** `scrollToTop` is not enabled at any tier and `post_questions` posts 3 questions
- **THEN** no trailing message is posted and posting behavior is identical to before this feature

### Requirement: Trailing link targets the batch's earliest message

The system SHALL resolve the trailing link target to the earliest posted question message in the whole batch identified by `batchId` (ordering the batch's question records by post time and taking the first available `messageLink`), so that an `appendToPreviousBatch` fire links to the original top of the batch rather than the first question of the current fire.

#### Scenario: Append links to the original top

- **WHEN** a prior fire posted questions for a batch, and a later `appendToPreviousBatch` fire (with `scrollToTop` enabled) adds more questions to that same batch
- **THEN** the trailing message links to the first question of the original (earlier) fire, not the first question of the append fire

#### Scenario: Missing permalink is skipped gracefully

- **WHEN** `scrollToTop` is enabled but no question in the batch has a usable `messageLink`
- **THEN** the trailing message is skipped, a warning is logged, and the fire otherwise completes normally

### Requirement: Scroll-to-top is mechanical and not persisted

The trailing message SHALL be produced deterministically by `post_questions` without involving Claude, `get_ideas`, or any prompt, and the resolved `scrollToTop` value SHALL NOT be stamped on the question record. The trailing label SHALL be resolved through the plugin's localization (`sdk.t()`) with keys present in both the `en` and `fr` dictionaries.

#### Scenario: No prompt or record involvement

- **WHEN** the trailing message is posted
- **THEN** it is built entirely from a localized label and the resolved permalink, with no `get_ideas` roll and no `scrollToTop` field written to the question record

### Requirement: Scroll-to-top is configurable through existing surfaces

The system SHALL allow setting `scrollToTop` per game via `upsert_game` and at the workspace tier via `set_workspace_config` (each accepting a boolean to set, `null` to clear, omission to keep), SHALL surface the resolved/explicit value read-only in `list_games` (per-game when set, and under `workspaceDefaults` when set at the workspace tier), and SHALL validate the `config.json` workspace value as a boolean, rejecting non-boolean input while treating absence as the default.

#### Scenario: Set per game

- **WHEN** an admin calls `upsert_game` with `scrollToTop: true` for a game
- **THEN** that game's `scrollToTop` is set to `true` and `list_games` surfaces it for that game

#### Scenario: Clear via null

- **WHEN** an admin calls `upsert_game` with `scrollToTop: null` for a game that had it set
- **THEN** the game's `scrollToTop` field is cleared and resolution falls back to the workspace/default tier

#### Scenario: Rejects non-boolean config

- **WHEN** `config.json` sets the workspace `trivia.scrollToTop` to a non-boolean value
- **THEN** config parsing reports a validation error for `trivia.scrollToTop`
