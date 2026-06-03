## ADDED Requirements

### Requirement: "Tell me more" button on the revealed card

When a question is edited into its final reveal state, the trivia plugin SHALL append a second localized button, "Tell me more", to the reveal actions block alongside "See your answer", IF AND ONLY IF the resolved `tellMeMore` config is enabled for that question's game. The button's `action_id` SHALL be `tell-me-more:<questionId>` (SDK-scoped to `plugin:trivia:`). When `tellMeMore` resolves to disabled, the button SHALL NOT be rendered and reveal behavior is identical to today.

The enablement SHALL be resolved at reveal time via a cascade of `game → workspace → default(disabled)`, mirroring the `allTimeRow` resolution pattern (no season or slot tier).

#### Scenario: Button rendered when enabled at game tier

- **GIVEN** a game with `tellMeMore: { enabled: true }`
- **WHEN** one of its questions is edited at reveal
- **THEN** the reveal actions block contains both a "See your answer" button and a "Tell me more" button
- **AND** the "Tell me more" button's `action_id` is `plugin:trivia:tell-me-more:<questionId>`

#### Scenario: Button rendered when enabled at workspace tier

- **GIVEN** `config.trivia.tellMeMore: { enabled: true }` and a game with no `tellMeMore`
- **WHEN** one of its questions is edited at reveal
- **THEN** the "Tell me more" button is present

#### Scenario: Button absent when disabled (default)

- **GIVEN** neither the game nor the workspace sets `tellMeMore` (or it resolves to `{ enabled: false }`)
- **WHEN** a question is edited at reveal
- **THEN** only the "See your answer" button is present and no "Tell me more" button is rendered

#### Scenario: Game disable overrides workspace enable

- **GIVEN** `config.trivia.tellMeMore: { enabled: true }` and a game with `tellMeMore: { enabled: false }`
- **WHEN** one of its questions is edited at reveal
- **THEN** the "Tell me more" button is absent

#### Scenario: Legacy question without postedBlocks has no button

- **WHEN** a processed question has no stored `postedBlocks` (the reveal edit is skipped entirely)
- **THEN** no "Tell me more" button is rendered, with no error surfaced

### Requirement: Clicking "Tell me more" removes the button and kicks off a thread conversation

A single action handler, registered once via a regex matching `tell-me-more:<questionId>` (SDK-scoped), SHALL serve the "Tell me more" button on every question. On click it SHALL acknowledge immediately, then: (1) remove the "Tell me more" button from the shared card via `chat.update` — rebuilt deterministically from the question's stored `postedBlocks` plus the reveal footer and the retained "See your answer" button — so the button is removed globally for all viewers; (2) post a short localized intro reply in the question's thread that tags the clicking user (e.g. *"User &lt;@U123&gt; asked for more information, here we go:"*); and (3) start a Claude Q&A turn in that thread (via the `plugin-thread-conversation` SDK capability) seeded with the question text and correct answer, instructing Claude to surface interesting details about the question and its answer.

The thread anchor SHALL be the question's own message (its `ts`, derived from the stored `messageLink`), so the conversation hangs as a thread under the revealed question.

#### Scenario: Button removed globally on first click

- **WHEN** any user clicks "Tell me more"
- **THEN** the card is updated to remove the "Tell me more" button while retaining the "See your answer" button and the reveal footer
- **AND** the removal is visible to all viewers of the message (the card is shared)

#### Scenario: Intro reply tags the clicking user

- **WHEN** user `U123` clicks "Tell me more"
- **THEN** a reply is posted in the question's thread that mentions `<@U123>` and reads as an intro lead-in (e.g. "asked for more information, here we go:")

#### Scenario: Claude follow-up surfaces details in the thread

- **WHEN** the handler kicks off the thread conversation
- **THEN** a Claude Q&A turn is started in the question's thread, seeded with the question and its correct answer, instructing Claude to find interesting details
- **AND** Claude's answer is delivered as a reply in that thread

#### Scenario: Already-removed button is a no-op

- **WHEN** two clicks race and the "Tell me more" button has already been removed by the first
- **THEN** the second click acknowledges and does not start a duplicate conversation or post a duplicate intro

#### Scenario: Slack client not yet connected

- **WHEN** the handler fires before the Slack client is available
- **THEN** it acknowledges, logs a warning, and returns without throwing

#### Scenario: Unparseable question reference

- **WHEN** the clicked `action_id` cannot be parsed to a known question, or the question lacks a parseable `messageLink`
- **THEN** the handler logs a warning and returns without posting or kicking off a conversation

### Requirement: The "Tell me more" thread auto-follows

The Claude turn started by "Tell me more" SHALL create a session whose thread is auto-follow-enabled (`autoResponseActive` true), so that subsequent human replies in the thread continue the conversation through the standard thread auto-respond path. (Tuning the follow-up gate's leniency is out of scope — a separate feature owns that.)

#### Scenario: Follow-up reply continues the conversation

- **GIVEN** a "Tell me more" conversation has been kicked off in a question's thread
- **WHEN** the clicking user (or another user) posts a genuine follow-up question in that thread
- **THEN** the standard thread auto-respond path finds the session and Claude responds in the thread

### Requirement: "Tell me more" user-facing strings are localized

Every user-facing string introduced by the feature — the "Tell me more" button label and the intro-reply text — SHALL resolve through the trivia plugin's `t()` with both English and French values present, and the i18n parity test SHALL pass (no French value identical to English). The prompt and context handed to Claude (the via-Claude path) SHALL remain English.

#### Scenario: Button and intro render in the configured language

- **WHEN** the workspace language is French
- **THEN** the "Tell me more" button label and the intro reply render in French

#### Scenario: New keys have parity across locales

- **WHEN** the i18n parity test runs
- **THEN** every new "Tell me more" key exists in both `en` and `fr` with no French value left identical to English
