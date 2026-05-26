## MODIFIED Requirements

### Requirement: Reveal flow resolves question before parsing reactions

The reveal flow (wholly inside `process_reveal_answers`) SHALL resolve the pending question record before assembling voter buckets. Scoring SHALL be derived from `answers.json` for all formats — Slack reactions SHALL NOT drive scoring on any answers-format value.

When `question.answersFormat` is `"boolean"`:
- Users with `SubmittedAnswer` rows where `answer === question.isTrue` land in `voters.correct`.
- Users with rows where `answer !== question.isTrue` land in `voters.incorrect`.
- The "fence-sitter" classification (voted both `:+1:` and `:-1:`) SHALL NOT exist — button click semantics make simultaneous opposite votes impossible.

When `question.answersFormat` is `"choice"`:
- Users with rows where `answerIndex === question.correctIndex` land in `voters.correct`.
- Users with rows where `answerIndex !== question.correctIndex` land in `voters.incorrect`.
- The "multi-react silently-voided" classification SHALL NOT exist — only one button click is the source of truth; subsequent clicks overwrite via `updateAnswer`.
- Persisted rows continue to carry `answerIndex: number` (no `answer: boolean`).

For all formats, the bot's user ID and every flagged cheater for the question SHALL be excluded from all `voters.*` buckets AND from the `voters.reactions` commentary list.

`question.questionType` (`"fact"` vs `"topical"`) SHALL NOT affect reveal behavior.

#### Scenario: Boolean reveal reads from answers.json

- **WHEN** the reveal flow processes a boolean question with `isTrue: true` and `answers.json` has `{ U1: true, U2: false }`
- **THEN** `voters.correct` contains U1, `voters.incorrect` contains U2
- **AND** the flow makes no reaction-based scoring decisions

#### Scenario: Choice reveal reads from answers.json

- **WHEN** the reveal flow processes a choice question with `correctIndex: 2` and `answers.json` has `{ U1: { answerIndex: 2 }, U2: { answerIndex: 0 } }`
- **THEN** `voters.correct` contains U1, `voters.incorrect` contains U2

#### Scenario: No fence-sitters category in payload

- **WHEN** any reveal payload is returned
- **THEN** the `voters` object SHALL NOT have a `fenceSitters` field

#### Scenario: No multi-react void in payload

- **WHEN** the reveal flow processes a choice question and any user added multiple numbered emoji as reactions
- **THEN** the user's button click (if any) determines their bucket placement; reactions do not void anything
- **AND** the payload shape contains no field that names or counts multi-react voters

#### Scenario: questionType does not alter reveal

- **WHEN** the reveal flow processes a question with `questionType: "topical"`
- **THEN** the flow behaves identically to a `questionType: "fact"` question of the same `answersFormat`

### Requirement: Bot auto-reactions sized to answersFormat

The bot SHALL NOT auto-attach reactions to questions of ANY answers format. `post_questions` SHALL append answer-buttons via an `actions` block instead (see `trivia-question-posting`).

Users may freely add their own reactions to question messages. Those reactions are read at reveal time purely as commentary (see `trivia-reveal-processor`'s `voters.reactions` field) — they SHALL NOT drive scoring.

#### Scenario: No auto-attached reactions on boolean

- **WHEN** the bot posts a question with `answersFormat: "boolean"`
- **THEN** zero reactions are auto-attached to the message
- **AND** the message includes an `actions` block with `👍 TRUE` and `👎 FALSE` buttons

#### Scenario: No auto-attached reactions on choice

- **WHEN** the bot posts a question with `answersFormat: "choice"` of any choice count
- **THEN** zero reactions are auto-attached
- **AND** the message includes an `actions` block with one button per choice

#### Scenario: No auto-attached reactions on freeform

- **WHEN** the bot posts a question with `answersFormat: "freeform"`
- **THEN** zero reactions are auto-attached
- **AND** the message includes an `actions` block with an "Answer" button

#### Scenario: User-added reactions are preserved as commentary

- **GIVEN** a posted question and user U1 reacts with `:fire:`
- **WHEN** `process_reveal_answers` runs
- **THEN** `voters.reactions` contains `{ userId: "U1", emojis: ["fire"] }`

## REMOVED Requirements

### Requirement: Choice-question reveal hard-fails on unresolvable question

**Reason**: The hard-fail-vs-best-effort branching was tied to the reaction-derivation pipeline (where guessing a `correctIndex` was the failure mode). With scoring derived from on-disk `SubmittedAnswer` rows, the question's `correctIndex` is already known by the time scoring runs (it's loaded from the question record). If the question record cannot be loaded, the entire reveal aborts uniformly across formats — no format-specific branching is needed.

**Migration**: None required — the unresolvable-question failure mode in the new code path is uniformly hard-fail (caller logs + skips that target). The boolean "best-effort fallback" path is gone but was a workaround for the reaction-derivation flow that no longer exists.
