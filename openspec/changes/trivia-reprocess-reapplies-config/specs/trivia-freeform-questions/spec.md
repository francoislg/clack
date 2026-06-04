## ADDED Requirements

### Requirement: Freeform Re-Judging in Reprocess Mode

When `compute_answers` runs in reprocess mode (per `trivia-reveal-processor`) for a freeform question, the per-answer reveal judge SHALL be re-run against EVERY one of the question's RETAINED `answerText` rows using the question's re-stamped `judgeLeniency`, overwriting each row's derived verdict (`correct`, `judgeReason`) in place. No separate reset pass is performed — selecting all rows for judging and writing the new verdict supersedes the prior one; a row whose new verdict carries no reason has its `judgeReason` cleared. The stored `answerText` SHALL NOT be modified or deleted. The exact-match pre-check SHALL still short-circuit deterministically before the model judge. This whole-set re-judging SHALL occur ONLY in reprocess mode; default reveal SHALL continue to judge only never-judged (`correct === undefined`) rows and SHALL NOT touch already-judged verdicts.

#### Scenario: Reprocess re-judges a previously-judged freeform answer in place

- **GIVEN** freeform question `Q` stamped `judgeLeniency: "strict"` with a judged row `{ U1: answerText "twenty", correct: false, judgeReason: "..." }`, and the current cascade resolves `judgeLeniency` to `"lenient"`
- **WHEN** `compute_answers({ game, reprocessQuestionIds: ["Q"] })` reprocesses `Q` (which re-stamps `judgeLeniency: "lenient"`)
- **THEN** U1's row is re-judged under `"lenient"`, overwriting its prior verdict (and clearing the stale `judgeReason` when the new verdict carries none)
- **AND** U1's stored `answerText` remains `"twenty"`

#### Scenario: Default reveal does not reset already-judged freeform rows

- **GIVEN** a freeform question in the oldest pending batch with three retained rows: one `correct: true`, one `correct: false`, one `correct === undefined`
- **WHEN** `compute_answers({ game })` runs in default mode
- **THEN** only the `correct === undefined` row is judged
- **AND** the two already-judged rows' verdicts are left unchanged

#### Scenario: A re-judge whose judge call exhausts retries keeps the prior verdict

- **GIVEN** a freeform question reprocessed in reprocess mode, where one retained row already had a verdict and its re-judge call exhausts its retry budget (returns no verdict)
- **WHEN** that row is re-judged
- **THEN** the row keeps its PRIOR verdict (it is not overwritten and not blanked)
- **AND** the question's `processedAt` is NOT stamped (so a later reveal re-judges the row)
- **AND** the failure is reported, mirroring the existing default-mode retry-exhaustion behavior
