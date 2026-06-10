## Context

Trivia's question lifecycle assumes the correct answer is known and stamped onto the record at `save_question` time: each `AnswerTypeHandler.getSavedQuestion` *requires* its answer key (`isTrue` / `correctIndex` / `expectedAnswer`), and the reveal processor scores player picks against that stored key. That assumption is the only thing standing between trivia and a "prediction" game, where the outcome is a future real-world event.

Two existing pieces make this a small change rather than a large one:
- **`questionType: "topical"`** already forces Claude to WebSearch a real-world event at generation time and capture a `sourceUrl`. A prediction is the mirror — WebSearch an *upcoming* event — so the generation-with-web-search scaffolding exists.
- **Reveal reprocess mode** (`tools/reveal/computeAnswers.ts`) already re-derives each player's `correct` verdict from a *changed* answer key, treating the raw button click as canonical and never deleting it. That is precisely the "the answer became known later, re-score" primitive a prediction needs.

This change therefore introduces a `prediction` questionType whose answer is **deferred** to a new settle step, and reuses the reprocess path for scoring.

## Goals / Non-Goals

**Goals:**
- A third `questionType` value `prediction`, mutually exclusive with `fact`/`topical`, composing with `answersFormat` `boolean`/`choice`.
- `save_question` persists a prediction with no answer key and `resolved: false`.
- A `settle_question(questionId, outcome)` admin tool that validates the outcome through the same answer handler, stamps the key, sets `resolved: true`, and triggers re-scoring.
- The reveal prompt WebSearches results and settles each prediction before scoring; unresolved predictions are skipped and labeled "pending", re-settleable idempotently on a later re-run.
- Config-forced opt-in: global default weight `0`, never surprise-rolled into existing games.

**Non-Goals:**
- Dynamic per-match question count (variable N). v1 uses the existing fixed `format.questions[]` slots. Data-driven count is a separate follow-up.
- An automatic catch-up cron for late results. v1 retries via a **manual** reveal re-run.
- (Now in scope) Freeform predictions: the canonical answer spec (`expectedAnswer` + `acceptableAnswers` + `gradingNotes`) is prepared at settle time instead of save time; `freeformAnswerShape` + `judgeLeniency` stay static at save. The reveal judge runs unchanged.
- A dedicated predictions leaderboard surface — seasons already aggregates points.

## Decisions

### `prediction` is a third `questionType` VALUE, not a `prediction: boolean` flag
`questionType` already means *where the knowledge comes from* (`fact` = static, `topical` = recent web event). A prediction is *inherently* a future-event web search — there is no coherent "fact prediction" (static + deferred is a contradiction). Modeling it as a third mutually-exclusive value means it cleanly replaces fact/topical per question while still composing with `answersFormat`, mirroring how `topical` composes today. A standalone boolean would admit nonsense combos (`fact` + `prediction`).
**Alternative considered:** a separate orthogonal `prediction: true` axis — rejected; it creates contradictory combinations and a redundant axis when the existing one extends naturally.

### Answer-key validation MOVES IN TIME from save to settle — it is not duplicated
Today `AnswerTypeHandler.getSavedQuestion` both *validates* and *builds* the answer key. For predictions, `save_question` skips that key validation (when `questionType === "prediction"`) and persists `resolved: false`. The SAME handler key-validation then runs at `settle_question` time against the supplied `outcome`. This respects the project's "AnswerTypeHandler owns format logic" rule — consumers don't branch on `answersFormat`; the handler's own key-validation is simply invoked later. Concretely, the handler grows a small `validateOutcome(args)` / `buildKey(outcome)` seam that both `save_question` (fact/topical) and `settle_question` (prediction) call.
**Alternative considered:** make the key fields optional inside each handler's `getSavedQuestion` and re-validate inline at settle — rejected; it scatters prediction-awareness across three handlers and duplicates validation.

### `settle_question` is a distinct admin tool, separate from `compute_answers`
Settling (learning + stamping the outcome) is conceptually and temporally distinct from scoring (deriving verdicts). Keeping `settle_question` separate lets the reveal prompt run it as an explicit leading step, lets an admin settle by hand, and lets a re-run settle late questions without re-touching already-scored ones. After settle stamps the key, the existing reprocess path in `compute_answers` derives `correct` — no new scoring code.
**Alternative considered:** fold settling into `compute_answers` (auto-WebSearch inside the processor) — rejected; couples a deterministic processor to web search and obscures the partial/skip flow.

### Unresolved-at-reveal → skip + "pending", idempotent manual retry
If a prediction is still `resolved: false` when reveal runs (no result found — late or postponed match), the reveal processor **skips** it (does not score, does not mark `processedAt` for that question) and the reveal post renders "⏳ result pending". Because raw button clicks are canonical and never deleted, a later re-run of the reveal settles only the still-`resolved: false` questions and scores them, leaving already-counted questions untouched. Idempotency falls out of the existing reprocess guard (skip rows that already carry a verdict).
**Alternative considered:** an auto catch-up cron — deferred to a follow-up to keep v1 small; the manual re-run is sufficient and uses machinery that already exists.

### Config-forced, default `0`
`questionType`'s global default becomes `{ fact: 1, topical: 0, prediction: 0 }`. A prediction game sets its `questionType` weights to `{ prediction: 1 }` through the existing cascade (slot/season/game/workspace). Existing games never emit a prediction. `get_ideas`' weighted roll already handles a zero-weight value (never selected), so no roll-logic change is needed beyond accepting the value.

### Schema additions are graceful/optional
`TriviaQuestion` gains `resolved?: boolean`, `resolvedOutcome?` (the settled answer, shape per `answersFormat`), and `resolvedAt?: string`. All optional: an absent `resolved` on a legacy record reads as a normal answered question (it has its key from save time). The graceful zod state schema models them as optional — no `.strict()`, no date-coercion — so existing `questions.json` files survive untouched. `questionType`'s validator union gains `"prediction"`.

## Risks / Trade-offs

- **Claude mis-reads or fabricates a match result at settle time** → the settle step requires a `sourceUrl` (reuse topical's evidence discipline); if no authoritative result is found, Claude must NOT settle — it leaves the question pending rather than guessing. Admin can `override_answer` to correct a bad settle (existing tool).
- **A prediction posted but never settled lingers forever** → acceptable for v1; it simply stays "pending" and unscored. A follow-up catch-up cron or an admin sweep can close the gap.
- **Ambiguous outcomes (abandoned match, contested result)** → `settle_question` accepts only a value that validates through the answer handler (a listed choice / a boolean); genuinely void events stay pending. No "void/push" outcome in v1.
- **Reveal post must render a mix of scored and pending questions in one fire** → the reveal card projection gains a "pending" branch; resolved questions render exactly as today.
- **Players expect picks to lock at reveal** → picks already stop being accepted once the question is processed; a pending (skipped) prediction keeps accepting picks until it is settled+scored on the retry, which is the desired behavior (the event hasn't concluded yet).

## Migration Plan

Additive and opt-in. No data migration: new `TriviaQuestion` fields are optional and created on first prediction. `questionType`'s default gains a `prediction: 0` entry — a no-op for existing games. Rollback = stop setting `questionType: { prediction: 1 }` on any game (predictions stop generating); already-posted predictions can still be settled or left pending. No core schema or shared-state changes.

## Open Questions

- Should the reveal "pending" line tell players *when* a retry will happen, or stay generic? (Leaning generic for v1, since retry is manual.)
- Should `settle_question` be exposed as a Home Tab / Slack action for admins, or Claude-only via the reveal prompt for v1? (Leaning Claude-only via the reveal prompt; admin override already exists through `override_answer`.)
- Does a prediction need its own `eventDate` (kickoff time) on the record to help the settle step decide "has this concluded yet"? (Reuse topical's optional `eventDate`; the settle WebSearch can also just check.)
