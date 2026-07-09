## REMOVED Requirements

### Requirement: `settle_question` answers a prediction or invalidates any question

**Reason**: Superseded by the three-verb requirement below — `settle_question` gains a `reopen` verb (the inverse of invalidate), and the two existing verbs are unchanged in behavior.
**Migration**: Covered in full by "`settle_question` answers, invalidates, or reopens a question" and "`settle_question` reopen restores an invalidated question".

## ADDED Requirements

### Requirement: `settle_question` answers, invalidates, or reopens a question

The admin-gated MCP tool `settle_question` SHALL decide a question's fate with EXACTLY ONE of:

- `outcome` — answers a pending prediction: validates the value through the same `settleOutcome` path, stamps the answer key + `resolved: true` + `resolvedOutcome` + `resolvedAt`. Errors if the target already has an answer key, unless `override: true` re-settles it (re-stamps the key and clears stale verdicts).
- `invalidate: true` + `invalidatedReason` — marks ANY question (any format/type, even an already-answered or already-revealed one) INVALIDATED: stamps `resolved: true` + `invalidated: true` + `invalidatedReason`, and CLEARS any verdicts on its answers so it scores 0 for everyone.
- `reopen: true` — reverses a prior invalidation (see the dedicated requirement below).

Passing zero or more than one of `outcome` / `invalidate` / `reopen` SHALL return an error and make no change.

The tool's description SHALL reference only its real argument names (`invalidate`, `invalidatedReason`, `reopen`) and the real record field (`invalidated`) — never `skip`, `skippedReason`, or `skipped`, which have never existed in the schema or on the record.

#### Scenario: answer a boolean prediction

- **WHEN** `settle_question` is called with `outcome: true` for a boolean prediction
- **THEN** the record gains `isTrue: true`, `resolved: true`, `resolvedOutcome`, and `resolvedAt`

#### Scenario: answering validates through the format

- **WHEN** `settle_question` passes an `outcome` that is not valid for the question's answer format
- **THEN** the tool returns an error and makes no change

#### Scenario: invalidate clears existing verdicts

- **WHEN** `settle_question` is called with `invalidate: true` + a reason on a question whose answers were already scored
- **THEN** the record gains `invalidated: true` + the reason, and every answer's verdict is cleared so it counts for 0

#### Scenario: invalidate requires a reason and the three verbs are mutually exclusive

- **WHEN** `settle_question` is called with `invalidate: true` and no reason, OR with more than one of `outcome` / `invalidate` / `reopen`, OR with none of them
- **THEN** the tool returns an error and makes no change

#### Scenario: description names only real fields

- **WHEN** the `settle_question` tool description is inspected
- **THEN** it documents `invalidate` / `invalidatedReason` / `reopen` and the `invalidated` record field, and contains no reference to `skip`, `skippedReason`, or `skipped`

### Requirement: `settle_question` reopen restores an invalidated question

`settle_question({ reopen: true })` SHALL reverse a prior invalidation on the named question. It SHALL error (making no change) when the question is not currently `invalidated: true` — there is nothing to reopen.

On success it SHALL apply a single atomic record patch:

- Always: remove `invalidated` and `invalidatedReason` from the record.
- When the question has NO answer key (per the answer-format handler's `hasAnswerKey`): additionally restore `resolved: false` and remove `resolvedAt` / `resolvedOutcome` — a never-settled prediction returns to pending, and the `UNDECIDED_PREDICTIONS` gate applies to it again if it is still unprocessed.
- When the question HAS an answer key: `resolved` / `resolvedAt` / `resolvedOutcome` SHALL be left untouched — a settled-then-invalidated question returns to its settled state (a wrong key is corrected separately via `outcome` + `override: true`).

Reopen SHALL NOT touch `processedAt` (a question revealed-as-invalidated stays out of the pending flow and is recovered via `compute_answers` reprocess; one invalidated before its reveal returns to the pending flow and reveals normally with its batch), SHALL NOT touch `answerLocked`, and SHALL NOT add, delete, or modify any answer row (verdicts were already cleared at invalidation; reprocess re-derives them from the retained raw submissions once the question is settled).

When the question has a posted card (`messageLink` present), the success result SHALL include the standard `refreshHint` naming the repaint call for this question id.

#### Scenario: reopen a never-settled invalidated prediction

- **GIVEN** a prediction invalidated while still keyless and unprocessed (`invalidated: true`, `resolved: true`, no answer key, `processedAt: undefined`)
- **WHEN** `settle_question({ reopen: true })` is called for it
- **THEN** `invalidated` and `invalidatedReason` are removed, `resolved` is `false`, and `resolvedAt` / `resolvedOutcome` are removed
- **AND** a subsequent `settle_question({ outcome })` settles it like any pending prediction (no `override` needed)

#### Scenario: reopen a settled-then-invalidated question

- **GIVEN** a question that was answered (key stamped) and later invalidated
- **WHEN** `settle_question({ reopen: true })` is called for it
- **THEN** `invalidated` and `invalidatedReason` are removed while the answer key, `resolved: true`, `resolvedOutcome`, and `resolvedAt` are all retained

#### Scenario: reopen requires an invalidated question

- **WHEN** `settle_question({ reopen: true })` is called for a question that is not invalidated
- **THEN** the tool returns an error and makes no change

#### Scenario: reopen preserves processedAt, lock state, and answer rows

- **GIVEN** an invalidated question with `processedAt` set, `answerLocked: true`, and retained raw answer rows
- **WHEN** `settle_question({ reopen: true })` succeeds
- **THEN** `processedAt` and `answerLocked` are unchanged and no answer row is added, deleted, or modified

#### Scenario: reopen returns the repaint hint

- **GIVEN** an invalidated question with a posted card (`messageLink` present)
- **WHEN** `settle_question({ reopen: true })` succeeds
- **THEN** the result includes the standard `refreshHint` naming the repaint call for that question id
