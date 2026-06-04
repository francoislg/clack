## MODIFIED Requirements

### Requirement: Reprocess mode re-derives verdicts on retained answers (never deletes)

The tool SHALL enter reprocess mode when EITHER `reprocessQuestionIds` is a non-empty array OR `reprocessBatchId` is a non-empty string. The set of targeted questions SHALL be the UNION of: every id listed in `reprocessQuestionIds`, and — when `reprocessBatchId` is set — every question whose `batchId` equals it (plus the single legacy row whose `id` equals it when no `batchId` matches, mirroring `update_answers_block`'s batch selection). For EACH targeted question, in `postedAt`-ascending order, the tool SHALL:

1. Re-resolve the question's config-derived frozen fields from the LIVE cascade and re-stamp them on the question record BEFORE scoring: `revealResponses` for every answer format, and `judgeLeniency` for freeform questions only. The cascade context for each question SHALL be rebuilt from that question's OWN stamped `slot.index` and `season` (the identity `post_questions` used to stamp it) via `buildCascadeContext`; questions with no stamped `slot`/`season` resolve through the game/workspace tiers. A re-stamp whose resolved value equals the stamped value is a harmless overwrite. If context rebuild or resolution throws for a question, the tool SHALL record a per-id error and skip that question WITHOUT overwriting its stamped value or scoring it (reusing the per-id error path), and SHALL continue with the remaining targets.
2. Bring the question's verdicts in line with its CURRENT key / config on EVERY retained `SubmittedAnswer` row whose `questionId` matches, written in place via `updateAnswer`:
   - boolean: `correct = (row.answer === question.isTrue)`;
   - choice: `correct = (row.answerIndex === question.correctIndex)`;
   - freeform: re-judge EVERY retained row via the per-answer reveal judge using the re-stamped `judgeLeniency`, overwriting each verdict in place (default reveal judges only never-judged `correct === undefined` rows).
3. Stamp `processedAt = Date.now()` on the question (overwriting any prior value).
4. Include the resulting reveal in the returned `reveals[]` with `wasReprocessed: true`.

The raw submission (`answer` / `answerIndex` / `answerText`) is the canonical record and SHALL NOT be deleted or modified by reprocess — only the derived `correct` verdict and the re-stamped `revealResponses` / `judgeLeniency` are recomputed. Boolean/choice re-derivation is a full assignment that flips a verdict in EITHER direction: a stale `correct: true` becomes `false` when the raw answer no longer matches the corrected key, and a stale `correct: false` becomes `true` when it does. The intent of reprocess mode is "bring an already-revealed question fully in line with the CURRENT answer key AND CURRENT config" — e.g. after an admin fixes a wrong `isTrue` / `correctIndex`, or changes `revealResponses` / `judgeLeniency` and wants the already-posted batch updated.

#### Scenario: Reprocess re-derives every row's verdict in both directions

- **GIVEN** boolean question `Q1` with `isTrue: true` and two retained rows: U1 (`answer: true`, stale `correct: false`) and U2 (`answer: false`, stale `correct: true`)
- **WHEN** `compute_answers({ game: "main", reprocessQuestionIds: ["Q1"] })` is called
- **THEN** both rows are retained (none deleted)
- **AND** U1's verdict is re-derived to `correct: true` (flip up) and U2's to `correct: false` (flip down)
- **AND** each row's raw `answer` is unchanged
- **AND** `reveals[0].wasReprocessed === true`
- **AND** `Q1.processedAt` is overwritten with the current time

#### Scenario: Reprocess never deletes answer rows

- **GIVEN** boolean question `Q1` with 3 retained rows in `answers.json`
- **WHEN** `compute_answers({ game: "main", reprocessQuestionIds: ["Q1"] })` is called
- **THEN** all 3 rows for `Q1` remain in `answers.json` (only their `correct` verdicts are recomputed)
- **AND** `reveals[0].wasReprocessed === true`

#### Scenario: Reprocess re-stamps revealResponses from the current cascade

- **GIVEN** question `Q1` stamped `revealResponses: "yes"` and a current cascade (after an admin config edit) that resolves `revealResponses` to `"just-correctness"`
- **WHEN** `compute_answers({ game: "main", reprocessQuestionIds: ["Q1"] })` is called
- **THEN** `Q1.revealResponses` is re-stamped to `"just-correctness"`
- **AND** `reveals[0].voters.revealResponses === "just-correctness"`
- **AND** a subsequent `update_answers_block` renders the card in `"just-correctness"` mode

#### Scenario: Reprocess re-judges freeform with the re-stamped leniency

- **GIVEN** freeform question `Q2` stamped `judgeLeniency: "strict"` with a retained row `{ U1: "twenty", correct: false }`, and a current cascade resolving `judgeLeniency` to `"lenient"`
- **WHEN** `compute_answers({ game: "main", reprocessQuestionIds: ["Q2"] })` is called
- **THEN** `Q2.judgeLeniency` is re-stamped to `"lenient"`
- **AND** U1's row is re-judged under `"lenient"`, overwriting its verdict in place (the stored `answerText` `"twenty"` is unchanged)
- **AND** `reveals[0].wasReprocessed === true`
- **AND** `Q2.processedAt` is overwritten

#### Scenario: Reprocess by batchId targets the whole batch

- **GIVEN** a posted batch with shared `batchId: "b-1"` covering questions `Q1`, `Q2`, `Q3`
- **WHEN** `compute_answers({ game: "main", reprocessBatchId: "b-1" })` is called
- **THEN** all three questions are reprocessed in `postedAt`-ascending order
- **AND** each returned reveal has `wasReprocessed === true`

#### Scenario: Reprocess by batchId falls back to a legacy id

- **GIVEN** a legacy question `Qx` with `batchId: undefined` and `id: "Qx"`, and no question whose `batchId` equals `"Qx"`
- **WHEN** `compute_answers({ game: "main", reprocessBatchId: "Qx" })` is called
- **THEN** `Qx` alone is reprocessed (the legacy id fallback, identical to `update_answers_block`'s selection)

#### Scenario: Reprocess by batchId matching nothing processes no questions

- **GIVEN** no question whose `batchId` or `id` equals `"missing"`
- **WHEN** `compute_answers({ game: "main", reprocessBatchId: "missing" })` is called
- **THEN** `reveals` is empty and no answer rows are modified

#### Scenario: Both reprocess targets provided are unioned

- **GIVEN** `Q1` (standalone) and a batch `b-1` covering `Q2`, `Q3`
- **WHEN** `compute_answers({ game: "main", reprocessQuestionIds: ["Q1"], reprocessBatchId: "b-1" })` is called
- **THEN** the targeted set is the union `{Q1, Q2, Q3}`, each reprocessed in `postedAt`-ascending order
- **AND** each returned reveal has `wasReprocessed === true`
