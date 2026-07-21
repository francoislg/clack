# trivia-answering-strategy

## ADDED Requirements

### Requirement: AnsweringStrategy interface owns answer-slot ownership

The trivia plugin SHALL define an `AnsweringStrategy` interface (in `src/plugins/trivia/answering/`) that is the single abstraction for answer-slot ownership and persistence, exposing: `getCurrentAnswerFor(userId, questionId)`, `answer(userId, questionId, patch, opts)`, `getFinalAnswers(questionId)`, `getAllScoredAnswers()`, `applyVerdict(ownerKey, questionId, patch)`, and `ownerLabel(ownerKey, deps)`. Consumers MUST NOT branch on an answering mode; ownership-specific behavior lives in the strategy implementation (the `AnswerTypeHandler` rule, applied to the ownership axis).

#### Scenario: Consumers resolve ownership through the strategy

- **WHEN** a scoring-view consumer needs an answer slot — the click installer/freeform modal (existing-row lookup + write), the live roster and reveal buckets (per-question read), the leaderboard and `retrieve_scores` (game-wide read), or `settle_question` (verdict write)
- **THEN** it calls the corresponding strategy member — `getCurrentAnswerFor` + `answer` for writes, `getFinalAnswers` for per-question reads, `getAllScoredAnswers` for game-wide reads, `applyVerdict` for verdict flips — rather than keying `(userId, questionId)` against the data layer directly

### Requirement: IndividualAnswering reproduces legacy semantics exactly

The shipped `IndividualAnswering` implementation SHALL reproduce today's behavior byte-for-byte: `answer` upserts by `(userId, questionId)` (update-in-place with timestamp bump when a row exists; append plus `recordJoin` and `refreshIdentities` on first write), projection methods return the raw individual rows unchanged, `applyVerdict` delegates to the data layer's `updateAnswer`, and `ownerLabel` renders via the existing `renderPlayerRef` semantics.

#### Scenario: Re-click overwrites the clicker's own row

- **WHEN** a user who already answered a question clicks a different option
- **THEN** their existing `(userId, questionId)` row is updated in place with the new patch and a bumped timestamp, and no second row is created

#### Scenario: First answer records join side effects

- **WHEN** a user answers a question for the first time
- **THEN** a new row is appended and `recordJoin(userId)` and `refreshIdentities([userId])` fire, exactly as before the refactor

#### Scenario: Behavior identity under the existing suite

- **WHEN** the full existing trivia test suite runs against the refactored code with `IndividualAnswering`
- **THEN** every test passes without modifying any existing assertion

### Requirement: Both write sites route through the strategy

The shared clickable vote installer AND freeform's modal-submit persistence SHALL persist answers exclusively via `strategy.answer(...)` (with `strategy.getCurrentAnswerFor(...)` for the existing-row lookup). Verdict-flipping writes (freeform judging, reprocess re-derivation, `settle_question`) SHALL go through `strategy.applyVerdict(...)`.

#### Scenario: Clickable vote persists via the strategy

- **WHEN** a boolean or choice vote button click is processed
- **THEN** the row is persisted through `strategy.answer(...)`, and the installer contains no direct `saveAnswer`/`updateAnswer` call

#### Scenario: Freeform modal submit persists via the strategy

- **WHEN** a freeform answer modal is submitted
- **THEN** the existing-row lookup goes through `strategy.getCurrentAnswerFor(...)` and the write through `strategy.answer(...)`, and the freeform modal handler contains no direct `saveAnswer`/`updateAnswer` call

#### Scenario: Freeform judge flips verdicts via the strategy

- **WHEN** the reveal-time freeform judge resolves a pending row's verdict
- **THEN** the flip is written through `strategy.applyVerdict(...)`, not a direct data-layer update

### Requirement: Read sites are classified scoring-view or audit-view

Every answer read site SHALL be classified exactly once: **scoring-view** consumers (leaderboard, round summary, reveal buckets, live roster, `retrieve_scores`, settle re-derivation) read through the strategy's projection methods; **audit-view** consumers (`override_answer`, `get_question_history`, cheat flagging/`remove_cheat`, the "See your answer" modal) read raw rows from the data layer directly. A guard test SHALL enforce that scoring-view files do not call `loadAnswers()` directly, with the audit-view files as an explicit allowlist.

#### Scenario: Audit tools keep raw-row access

- **WHEN** `override_answer` or `get_question_history` reads answers
- **THEN** it reads raw individual rows from the data layer, bypassing the strategy's projections

#### Scenario: Guard rejects unclassified direct reads

- **WHEN** a scoring-view file gains a direct `loadAnswers()` call
- **THEN** the guard test fails, forcing the author to route through the strategy or consciously reclassify the file
