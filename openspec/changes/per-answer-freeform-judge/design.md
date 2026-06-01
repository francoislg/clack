## Context

Freeform answers are graded at reveal time by a Haiku-class model. The shipped protocol assembled one prompt per question covering all that question's pending submissions, asked the model to echo a per-row key (`1.1`, `1.2`, …) on each verdict, and mapped verdicts back to rows by exact key match. A miss (empty array, mis-echoed key) fell through to `{ correct: false, reason: "judge-missing-verdict" }` — silently scoring a correct answer wrong.

The spec (`trivia-freeform-questions` → "Reveal-Time Batch Judging via Small Model") goes further than the shipped code: it describes a *single* call for the whole reveal across all freeform questions, with keys `1.1, 2.1, …`. The code had already drifted to per-question batching during `widen-answer-format-handler` (per-format handlers each run their own judge call). So the design has drifted twice and the spec is two steps behind. This change re-baselines it.

## Goals / Non-Goals

**Goals**
- Eliminate the `judge-missing-verdict` failure class entirely, not narrow it.
- Never let a model hiccup permanently score a player wrong.
- Keep judging behavior (typo tolerance, cross-language, multi-guess rejection, date tolerance) identical or better.

**Non-Goals**
- A deterministic numeric pre-check that bypasses the LLM for `date`/`countable`. Genuinely attractive and would have made both example cases pass without any model call — but it depends on a reliable source of the tolerance window. Parsing it out of free-text `gradingNotes` is fragile; persisting a structured `tolerance: { lo, hi }` at `save_question` time is cleaner but touches the generation path and save schema. Deferred to its own change.
- Changing the judge model tier (Haiku → Sonnet).

## Decision: judge granularity

```
   robustness ▲
              │   per-answer ●  (no keys · shape prompts · N calls · independent retry)
              │      ╱
              │   ● per-question + positional fallback   (1 call / question)
              │  ╱
              │ ● per-question batch (shipped)  ← judge-missing-verdict lived here
              │ ╱
              ●  whole-reveal batch (spec as written)
              └────────────────────────────────────────▶ fewer calls
```

**Chosen: per-answer.** One `sdk.askClaude` call per submission.

Why over the alternatives:
- **Kills the bug by construction.** One submission per call ⇒ no key to echo ⇒ nothing to mismatch. The verdict maps to its submission positionally. No fallback heuristic can regress.
- **Enables shape-specific prompts.** Each call already concerns exactly one question, so the system prompt can be the minimal rule set for that answer's `freeformAnswerShape` instead of a wall covering every shape. Smaller, focused prompts measurably help small models.
- **Independent retry.** A malformed verdict for one answer re-asks only that answer; one stuck row never poisons the others.

Rejected — **per-question + positional fallback** (pair verdicts to submissions by index when keys don't line up): recovers most robustness at 1/N the calls, but keeps the keyed prompt and its failure surface, and can't host shape-specific prompts cleanly. The simplicity and prompt-focus wins of per-answer outweigh the call-count savings.

**Cost of per-answer:** a question with N submissions fires N Haiku calls instead of 1. Haiku is cheap and the calls are independent, so they run with a bounded-concurrency fan-out (cap 6) — wall-clock stays flat for typical question sizes and a popular 80-answer question costs cents, not dollars.

## Decision: resilience contract

- **Re-ask budget.** `judgeAnswer` calls the model, parses strictly to `{ correct: boolean, reason? }`, and re-asks on any throw (bad JSON, missing/`non-boolean` `correct`, network error) up to `JUDGE_MAX_ATTEMPTS` (4). It throws only after the budget is spent.
- **Never silently wrong.** `judgeSubmissions` catches a per-answer throw and yields `verdict: null` for that row. `processReveal` leaves null rows pending (`correct` stays undefined), counts them, and — if any exist — returns `{ ok: false, error }` **without** stamping `processedAt`. Because pending rows are exactly what the reveal re-selects (`correct === undefined`), a re-reveal re-judges only the still-unscored submissions and converges. The reveal flow already accumulates per-question errors and continues, so one stuck question doesn't abort the batch.

This replaces the old `judge-error` (call threw) / `judge-missing-verdict` (key missed) reasons, both of which committed `correct: false`.

## Decision: shape-specific prompt blocks

A shared core (commit-to-one-answer, strict-JSON output) plus one block keyed on `freeformAnswerShape`:

| shape(s)              | block emphasis                                                        |
|-----------------------|-----------------------------------------------------------------------|
| `name` `place` `title`| synonyms, unambiguous translations, ~1–2 char typo tolerance, reject too-broad |
| `phrase`              | accept any rendition preserving the wording; partial-span per Notes   |
| `date`                | inclusive tolerance window (both endpoints), format-agnostic, date spans, reject sweeping ranges |
| `countable`           | digit ↔ spelled-out, stated tolerance else exact                      |
| `other`               | equivalent forms of the same value                                    |

The `date` block's explicit "inclusive of both endpoints" is what makes the `1995 ∈ [1995, 2005]` case unambiguous to the model; the named-entity block's typo clause covers `Ryan Reynold → Ryan Reynolds`.

## Risks

- **Per-answer is still an LLM.** It removes *dropped* verdicts (missing) but not *wrong* verdicts. A future deterministic pre-check (non-goal above) is the belt-and-suspenders follow-up for `date`/`countable`.
- **Re-reveal recovery is manual.** A fully-exhausted row stays pending until an admin re-runs the reveal. Acceptable: the retry budget makes total exhaustion astronomically unlikely once the prompt is a dead-simple single-answer yes/no.
