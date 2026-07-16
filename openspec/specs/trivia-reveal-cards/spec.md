# trivia-reveal-cards

## Purpose

When trivia questions are revealed, the plugin SHALL statically edit each question's original Slack message into a final, non-interactive state. The edit removes the voting interface, shows the correct answer and optional results footer per the question's disclosure mode, and provides a read-only modal for users to review their individual submission and verdict. All strings are localized.
## Requirements
### Requirement: Static reveal edit of the original question message

The static reveal edit of a question's original Slack message SHALL be performed by the `refresh_question_cards` tool (`trivia-card-projection`), not by the answer-compute tool. When `refresh_question_cards` projects a question, it SHALL edit that question's original Slack message exactly once (`chat.update`) into a final, static state. The edit SHALL be rebuilt deterministically from the question's stored `postedBlocks` (never from the message's current Slack state) so that repeated edits cannot accumulate stale blocks. The edit is a snapshot of current file state and SHALL be re-runnable: re-projecting after `answers.json` changes reconciles the card to the new state.

The rebuilt message SHALL preserve the original card body, SHALL remove the answer-actions block, SHALL append a static results footer, and SHALL append a single "See your answer" button.

#### Scenario: Original card body is preserved

- **WHEN** a question message is edited at reveal
- **THEN** the blocks above the answer-actions block (header, warm-up, card, closer) are unchanged from `postedBlocks`

#### Scenario: Rebuild is from postedBlocks, not current Slack state

- **WHEN** the reveal edit runs
- **THEN** the new block array is derived from the stored `postedBlocks` plus the appended results footer and button
- **AND** any live "Answered: …" roster footer or divider previously appended by live-phase edits is not carried over

#### Scenario: Legacy question without postedBlocks skips the edit

- **WHEN** a processed question has no stored `postedBlocks`
- **THEN** the reveal edit is skipped and a warning is logged
- **AND** reveal processing otherwise completes normally

#### Scenario: Message update failure is non-fatal

- **WHEN** the `chat.update` for the reveal edit fails (e.g. message deleted, rate limit)
- **THEN** the failure is logged
- **AND** the reveal payload, leaderboard, and season status still return successfully

### Requirement: Vote/answer affordance is replaced by a single "See your answer" button

The reveal edit SHALL remove the question's answer-actions block — identified by its `block_id` (`vote-actions:<questionId>` for boolean/choice, `freeform-answer-actions:<questionId>` for freeform) — and SHALL append a new actions block containing exactly one localized "See your answer" button whose `action_id` is `reveal-see-answer:<questionId>`. Any hint button residing in the removed answer-actions block SHALL be removed with it.

#### Scenario: Boolean/choice vote buttons removed

- **WHEN** a boolean or choice question is edited at reveal
- **THEN** the `vote-actions:<questionId>` block is absent from the edited message
- **AND** a single "See your answer" button is present

#### Scenario: Freeform Answer button removed

- **WHEN** a freeform question is edited at reveal
- **THEN** the `freeform-answer-actions:<questionId>` block is absent from the edited message
- **AND** a single "See your answer" button is present

#### Scenario: Hint button in the answer-actions block is removed with it

- **WHEN** a question whose answer-actions block also carried a hint button is edited at reveal
- **THEN** neither the vote/answer buttons nor the hint button remain
- **AND** only the "See your answer" button is present

### Requirement: Static results footer renders per `revealResponses` mode

The reveal edit SHALL append a static, localized results footer whose voter disclosure honors the question's stamped `revealResponses` mode, supporting all four modes equally. The footer SHALL be rendered from the reveal payload's `VoterBuckets` and `RevealAnswerDescriptor` (so bot and flagged cheaters, already excluded from the payload, never appear). Every mode SHALL include an "Answer was: …" line. The footer SHALL contain no Claude-generated text and no reaction commentary.

#### Scenario: "yes" mode names all buckets

- **WHEN** a question stamped `revealResponses: "yes"` is edited at reveal
- **THEN** the footer names the correct, incorrect, and no-answer voters
- **AND** includes the "Answer was: …" line

#### Scenario: "just-correctness" mode names buckets without freeform text

- **WHEN** a question stamped `revealResponses: "just-correctness"` is edited at reveal
- **THEN** the footer names the correct, incorrect, and no-answer voters
- **AND** does not print any freeform typed answer text

#### Scenario: "just-winners" mode names winners and shows anonymous counts

- **WHEN** a question stamped `revealResponses: "just-winners"` is edited at reveal
- **THEN** the footer names the correct voters
- **AND** shows the incorrect count and no-answer count without naming anyone

#### Scenario: "no" mode shows the answer only

- **WHEN** a question stamped `revealResponses: "no"` is edited at reveal
- **THEN** the footer shows the "Answer was: …" line with no voter names and no counts

#### Scenario: Answer line reflects the format

- **WHEN** the footer renders the answer line
- **THEN** a boolean question shows TRUE or FALSE, a choice question shows the correct option text, and a freeform question shows the expected answer

#### Scenario: Empty buckets are omitted

- **WHEN** a voter bucket for the active mode is empty (e.g. nobody answered incorrectly)
- **THEN** that bucket's line is omitted rather than rendered as an empty or placeholder line

### Requirement: "See your answer" opens a private read-only verdict modal

A single action handler, registered once via a regex matching `reveal-see-answer:<questionId>`, SHALL serve the "See your answer" button on every question. When clicked, it SHALL open a read-only modal (Close button only; no submit) scoped to the clicking user. The modal SHALL show the clicking user's own submitted answer together with a correct/incorrect verdict, or a "you did not answer" message when that user has no answer row for the question. The modal SHALL be localized.

#### Scenario: Single handler serves all questions

- **WHEN** the plugin registers reveal interactions at boot
- **THEN** exactly one `reveal-see-answer` action handler is registered (regex-based), covering every question

#### Scenario: Correct answer shows a correct verdict

- **WHEN** a user who answered correctly clicks "See your answer"
- **THEN** the modal shows their submitted answer with a correct verdict

#### Scenario: Incorrect answer shows an incorrect verdict

- **WHEN** a user who answered incorrectly clicks "See your answer"
- **THEN** the modal shows their submitted answer with an incorrect verdict

#### Scenario: No submission shows "did not answer"

- **WHEN** a user with no answer row for the question clicks "See your answer"
- **THEN** the modal shows a "you did not answer" message and nothing else

#### Scenario: Submitted answer reflects the format

- **WHEN** the modal shows the user's submitted answer
- **THEN** a boolean submission shows TRUE or FALSE, a choice submission shows the chosen option text, and a freeform submission shows the typed text

#### Scenario: Clicking does not reopen voting

- **WHEN** any user clicks "See your answer" after reveal
- **THEN** the modal is read-only and no answer is recorded or modified

### Requirement: All reveal-card user-facing strings are localized

Every user-facing string introduced by the reveal cards — the "See your answer" button label, the results-footer labels and answer line, the anonymous-count phrases, and the modal title and verdict lines — SHALL resolve through the trivia plugin's `t()` with both English and French values present. The modal verdict lines SHALL reuse the existing `modal.verdict_correct` / `modal.verdict_incorrect` / `modal.verdict_no_submission` strings.

#### Scenario: Footer and button render in the configured language

- **WHEN** the workspace language is French
- **THEN** the "See your answer" button label and all results-footer labels render in French

#### Scenario: New keys have parity across locales

- **WHEN** the i18n parity test runs
- **THEN** every new reveal-card key exists in both `en` and `fr` with no French value left identical to English

### Requirement: Reveal footer renders team names when teams mode is on

When the reveal payload carries team-grouped voter buckets, the reveal footer SHALL render team names in place of member names (free agents still rendered individually via `renderPlayerRef`, honoring the stamped `tagPlayers`). Team names are plain text and never Slack mentions. The footer never prints freeform answer texts (in individual mode either) — under `revealResponses: "yes"` on freeform questions, member answer texts SHALL instead be carried UNATTRIBUTED on the team's payload bucket entry (`teamVoters.*Teams[].answerTexts`), where the Claude-authored narrative quotes them under the team name.

#### Scenario: Footer shows team plus free agent

- **WHEN** the Correct bucket contains team "Red" and free agent Erica
- **THEN** the footer renders `✓ Correct: Red, <Erica per tagPlayers>` with no Red member names

#### Scenario: Freeform answer texts unattributed under team

- **WHEN** a freeform question with `revealResponses: "yes"` reveals with teams mode on and two Red members typed answers
- **THEN** the payload's team bucket entry carries both texts with no mapping back to which member typed which, and the narrative quotes them under "Red"

#### Scenario: Live roster stays individual

- **WHEN** a question is open (pre-reveal) with teams mode on
- **THEN** the live answer roster renders individual players exactly as today

