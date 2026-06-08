## ADDED Requirements

### Requirement: `override_answer` admin tool sets a verdict by hand

The Trivia plugin SHALL expose an `override_answer` MCP tool, gated to the `admin` role and registered always-on (NOT behind the `trivia:management` integration), that sets the correctness verdict on a single retained answer row by hand, or restores a previously-overridden row to its machine verdict.

The tool SHALL accept:

- `game` (string, required) — the game slug; validated against `config.trivia.games[]` per the `trivia-games` capability (unknown → structured "unknown game" error; disabled → structured "game is disabled" error).
- `questionId` (string, required) — the question within the named game whose answer row is being corrected.
- `userId` (string, required) — the Slack user ID whose answer row is being corrected.
- `correct` (boolean, optional) — the verdict to set; required in **override mode**.
- `reason` (string, optional) — a human-readable explanation, stored as the row's `judgeReason`; required (non-empty) in **override mode**.
- `restore` (boolean, optional) — when `true`, selects **restore mode**.

The two call shapes are mutually exclusive and SHALL be enforced in the handler (a flat input shape cannot express the either-or; the tool description SHALL document both shapes):

- **Override mode** (`restore` not set / falsey): `correct` and a non-empty `reason` are both required; the tool SHALL reject the call with a structured validation error when either is missing.
- **Restore mode** (`restore: true`): `correct`/`reason` are ignored.

The tool SHALL refuse, with a structured error, unless the targeted question has been revealed (`processedAt` is set). A question that has not been revealed has no verdict to override or restore.

When the targeted `(userId, questionId)` answer row does not exist, the tool SHALL return a structured "answer not found" error and mutate nothing.

**Override mode** — on success the tool SHALL, via `updateAnswer`, set the row's `correct` to the requested value and set `judgeReason` to the provided `reason`. It SHALL capture the pre-override verdict into `originalVerdict` as `{ correct, judgeReason? }` **only when `originalVerdict` is absent** — the first override snapshots the machine's original verdict, and subsequent overrides leave `originalVerdict` untouched so the original judgment is never lost.

**Restore mode** — when the row has no `originalVerdict`, the tool SHALL return a structured "nothing to restore" error and mutate nothing. Otherwise it SHALL, via `updateAnswer`, set `correct` and `judgeReason` back to the captured `originalVerdict` values and delete `originalVerdict`, so the row re-enters normal reprocess re-derivation.

In both modes the raw submission (`answer` / `answerIndex` / `answerText`) SHALL NOT be modified.

The tool result SHALL report that the verdict was overridden and SHALL indicate that the already-posted reveal card can be refreshed via the existing reprocess flow (`compute_answers` reprocess → `update_answers_block`).

#### Scenario: Overriding a revealed freeform verdict captures the original

- **GIVEN** freeform question `Q1` with `processedAt` set and a retained row `{ userId: "U1", answerText: "Lleida", correct: false, judgeReason: "too-broad" }` (no `originalVerdict`)
- **WHEN** `override_answer({ game: "main", questionId: "Q1", userId: "U1", correct: true, reason: "Accepted — valid alternate spelling" })` is called by an admin
- **THEN** the row becomes `{ correct: true, judgeReason: "Accepted — valid alternate spelling", originalVerdict: { correct: false, judgeReason: "too-broad" } }`
- **AND** `answerText` is unchanged
- **AND** the result indicates the reveal card can be refreshed via `compute_answers` reprocess → `update_answers_block`

#### Scenario: Second override preserves the original machine verdict

- **GIVEN** a row already overridden once: `{ correct: true, judgeReason: "manual A", originalVerdict: { correct: false, judgeReason: "too-broad" } }`
- **WHEN** `override_answer({ ..., correct: false, reason: "manual B" })` is called again
- **THEN** the row becomes `{ correct: false, judgeReason: "manual B", originalVerdict: { correct: false, judgeReason: "too-broad" } }`
- **AND** `originalVerdict` still holds the machine's original verdict (NOT the intermediate manual value)

#### Scenario: Override refused before reveal

- **GIVEN** freeform question `Q2` with `processedAt` unset and a pending row `{ userId: "U1", answerText: "...", correct: undefined }`
- **WHEN** `override_answer({ game: "main", questionId: "Q2", userId: "U1", correct: true })` is called
- **THEN** the tool returns a structured "question has not been revealed yet" error
- **AND** the row is unchanged

#### Scenario: Override of a missing answer row

- **WHEN** `override_answer` is called with a `(userId, questionId)` pair that has no answer row
- **THEN** the tool returns a structured "answer not found" error
- **AND** no row is created or modified

#### Scenario: Restore returns an overridden row to its machine verdict

- **GIVEN** an overridden row `{ correct: true, judgeReason: "manual", originalVerdict: { correct: false, judgeReason: "too-broad" } }` on a revealed question
- **WHEN** `override_answer({ game: "main", questionId: "Q1", userId: "U1", restore: true })` is called by an admin
- **THEN** the row becomes `{ correct: false, judgeReason: "too-broad" }` with `originalVerdict` deleted
- **AND** `answerText` is unchanged
- **AND** a subsequent reprocess re-derives this row normally (it is no longer locked)

#### Scenario: Restore with nothing to restore is rejected

- **GIVEN** a row that has never been overridden (no `originalVerdict`)
- **WHEN** `override_answer({ ..., restore: true })` is called
- **THEN** the tool returns a structured "nothing to restore" error
- **AND** the row is unchanged

#### Scenario: Override mode requires correct and reason

- **WHEN** `override_answer` is called without `restore` and missing `correct` or `reason` (or an empty `reason`)
- **THEN** the call is rejected with a structured validation error
- **AND** no answer row is modified

#### Scenario: Tool is admin-gated and always-on

- **WHEN** the trivia plugin loads
- **THEN** `override_answer` is registered with role `admin`
- **AND** it is NOT registered behind the `trivia:management` integration (it appears in an admin session's catalog without `attach_integration`)
- **AND** a session whose user role is below `admin` does not see the tool in its MCP catalog

### Requirement: Reprocess preserves manually-overridden verdicts

In reprocess mode, for any retained `SubmittedAnswer` row that has `originalVerdict` set (i.e. it was manually overridden via `override_answer`), the tool SHALL NOT re-derive the verdict (no boolean/choice recompute against the key, no freeform re-judge). The row's stored `correct` and `judgeReason` SHALL be left in place. The row SHALL still be included in the projected reveal buckets using its stored verdict, so a subsequent `update_answers_block` renders the manual override rather than a re-derived value.

Rows without `originalVerdict` (the default) SHALL be re-derived exactly as specified by the existing reprocess semantics.

#### Scenario: Reprocess skips re-judging an overridden freeform row

- **GIVEN** freeform question `Q1` (revealed) with two retained rows: `{ U1: "Lleida", correct: true, judgeReason: "manual", originalVerdict: { correct: false, judgeReason: "too-broad" } }` and `{ U2: "wrongville", correct: false }`
- **WHEN** `compute_answers({ game: "main", reprocessQuestionIds: ["Q1"] })` is called
- **THEN** U1's row is NOT re-judged — it keeps `correct: true` and its `originalVerdict`
- **AND** U2's row IS re-judged under the current leniency
- **AND** U1 appears in the projected `correct` bucket and U2 in the bucket its re-derived verdict dictates
- **AND** `reveals[0].wasReprocessed === true`

#### Scenario: Reprocess skips re-deriving an overridden boolean row

- **GIVEN** boolean question `Q3` with key `isTrue: true` and a row `{ U1: answer false, correct: true, originalVerdict: { correct: false } }`
- **WHEN** `compute_answers({ game: "main", reprocessQuestionIds: ["Q3"] })` is called
- **THEN** U1's verdict stays `correct: true` (NOT recomputed to `false` against the key)
- **AND** U1 is projected into the `correct` bucket

#### Scenario: Non-overridden rows still re-derive

- **GIVEN** question `Q1` with one overridden row (`originalVerdict` set) and several ordinary rows
- **WHEN** `Q1` is reprocessed
- **THEN** only the ordinary rows have their verdicts re-derived
- **AND** the overridden row is untouched
