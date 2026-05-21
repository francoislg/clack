## ADDED Requirements

### Requirement: Pending Free-Form Answer Storage

A `SubmittedAnswer` record SHALL be permitted to omit `correct` (i.e. `correct?: boolean`) and SHALL be permitted to carry an `answerText?: string` field. The combination `correct === undefined` together with a populated `answerText` denotes a pending freeform answer awaiting reveal-time validation. The exactly-one-of discriminator on the answer's content widens from `{ answer | answerIndex }` to `{ answer | answerIndex | answerText }`.

Pending rows SHALL be writable through a freeform modal-submit code path owned by the trivia plugin (not via `submit_answers` — that tool remains the boolean/choice MCP-surface). The existing `submit_answers` tool SHALL continue to write `correct: boolean` synchronously for boolean and choice answers exactly as today; it is not extended to accept freeform answers.

#### Scenario: Pending freeform row written

- **WHEN** the trivia plugin's freeform modal-submit handler writes a `SubmittedAnswer` for `userA` on a freeform question
- **THEN** the persisted row carries `answerText: <text>` and `correct === undefined`
- **AND** does not carry `answer` or `answerIndex`

#### Scenario: Boolean and choice rows unchanged

- **WHEN** `submit_answers` writes a boolean or choice answer row
- **THEN** `correct` is set synchronously at write time as before
- **AND** the row never carries `answerText`

### Requirement: Free-Form Answer Update Op

The trivia plugin's scoped data layer SHALL expose `updateAnswer(rowKey, partial: Partial<SubmittedAnswer>): Promise<void>` that locates a single existing answer row by a stable key and merges the supplied partial into it. The stable key MAY be an explicit `id` field added to `SubmittedAnswer` at write time, or the natural composite `(userId, questionId)` — the choice is captured in the design document; the requirement is that the op resolves a unique row by a stable identifier. When the resolved row does not exist, the op SHALL resolve without error and log a `warn`-level message identifying the unresolved key.

This op exists primarily so that reveal-time freeform judging can flip `correct` from `undefined` to the verdict without rewriting the row.

#### Scenario: Update flips correct from undefined to true

- **WHEN** a pending freeform row exists with `correct === undefined`
- **AND** `updateAnswer` is called with `{ correct: true }` for that row's key
- **THEN** the row is updated in place: `correct: true`, all other fields preserved
- **AND** the answers store contains exactly one row for that key (no duplicate written)

#### Scenario: Update of unresolved key

- **WHEN** `updateAnswer` is called with a key that does not match any row
- **THEN** the call resolves without throwing
- **AND** the answers store is unchanged
- **AND** a `warn`-level log entry is emitted naming the key

### Requirement: Leaderboard and Score Aggregation Exclude Pending Rows

`computeLeaderboard` and any other aggregation over `SubmittedAnswer[]` (e.g. the `retrieve_scores` payload assembly, the per-user stats in `submit_answers`' return shape) SHALL skip rows where `correct === undefined` entirely — they SHALL NOT increment `totalAnswered` and SHALL NOT increment `totalCorrect`. Pending rows SHALL be invisible to the leaderboard until reveal-time judging flips `correct` to a boolean.

#### Scenario: Pending row absent from leaderboard counts

- **GIVEN** the answers store contains one boolean row for `userA` (`correct: true`) and one pending freeform row for `userA` (`correct === undefined`)
- **WHEN** `computeLeaderboard` aggregates
- **THEN** `userA`'s entry shows `totalAnswered: 1, totalCorrect: 1`
- **AND** the pending row contributes nothing to either counter

#### Scenario: Verdict applied row counts normally

- **GIVEN** a previously pending freeform row whose `correct` was flipped to `true` by reveal-time judging
- **WHEN** `computeLeaderboard` re-aggregates
- **THEN** that row now increments both `totalAnswered` and `totalCorrect`
- **AND** behaves identically to a boolean/choice row going forward

### Requirement: Answer History Emits Optional Correct Field

`getQuestionHistory` (and any other reader that exposes per-answer correctness back to Claude or to a renderer) SHALL emit `correct?: boolean` rather than `correct: boolean`. The schema SHALL document that absence indicates "pending reveal-time judging." Callers that count `correct === true` already exclude undefined implicitly; the schema change makes the contract explicit so Claude does not misread a missing field as a false answer.

#### Scenario: History entry for a pending row

- **WHEN** `getQuestionHistory` is called and the answers store contains a pending freeform row
- **THEN** the returned answer entry carries `answerText` and omits `correct`
- **AND** the tool schema documents this case

#### Scenario: History entry for a scored row

- **WHEN** `getQuestionHistory` is called for a question whose answers have all been scored
- **THEN** every returned entry carries `correct: boolean`
- **AND** behavior is identical to today's history output
