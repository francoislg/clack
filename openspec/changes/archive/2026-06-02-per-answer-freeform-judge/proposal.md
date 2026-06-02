## Why

The freeform reveal judge batches every pending submission for a question into one Haiku call and maps verdicts back **by an echoed string key** (`1.1`, `1.2`, …). When the small model returns an empty array or a key that doesn't string-match, the verdict lookup misses and the row silently defaults to `correct: false` with reason `judge-missing-verdict`. The answer is scored wrong with no signal, and the reveal narration then **confabulates a justification** for the false it was handed — making a dropped-verdict infra failure look like a deliberate harsh call.

This is recurring and intermittent in production. Confirmed cases on the `clack-test` game:

- **Date tolerance:** expected `2000`, window `[1995, 2005]`, player typed `1995` → `judge-missing-verdict` → scored wrong, though `1995` is inside the inclusive window.
- **Minor typo:** expected `Ryan Reynolds`, player typed `Ryan Reynold` (one missing `s`, well inside the prompt's stated typo tolerance) → `judge-missing-verdict` → scored wrong; the reveal joked "one missing 's' and you go home."
- Five+ earlier rows across prior reveals hit the same `judge-missing-verdict` fallback.

The defect is structural: the batch protocol's key-echo mapping is the single point of failure. Both example answers were *correct* and should have been accepted.

## What Changes

- **Judge per answer, not per batch.** Replace the batch-with-keys protocol with one `sdk.askClaude` call per submission. With a single answer per call there is no key to echo or mismatch — the entire `judge-missing-verdict` class is eliminated by construction. Calls run with bounded concurrency.
- **Re-ask on a malformed verdict.** When the judge returns anything other than a clean `{ correct: boolean }`, re-ask up to a small retry budget before giving up.
- **Never silently score a dropped verdict wrong.** If retries are exhausted for a submission, leave the row pending (`correct` stays undefined), do NOT stamp `processedAt`, and surface an error so a re-reveal can recover it. A model hiccup never permanently scores a player wrong.
- **Shape-specific judge prompts.** Tailor the judge's system prompt to the question's `freeformAnswerShape`: `date`/`countable` get the numeric inclusive-tolerance rules, `name`/`place`/`title` get the typo + translation rules, `phrase` gets the rendition rules, etc. A focused prompt makes the small model more reliable than the prior one-wall-of-rules prompt.

Behavior preserved verbatim: multi-guess rejection, qualifier acceptance, cross-language acceptance, and all existing rejection reasons.

## Capabilities

### New Capabilities
<!-- None -->

### Modified Capabilities
- `trivia-freeform-questions`: Reveal-time judging moves from a single batched, key-mapped call to one resilient per-answer call; adds a re-ask budget, a never-score-a-dropped-verdict-wrong guarantee, and shape-specific judge prompts.

## Impact

- `src/plugins/trivia/freeform/judge.ts` — replace `buildJudgePrompt`/`parseJudgeResponse` (batch, keyed) with `buildSingleJudgePrompt`/`parseSingleVerdict`/`judgeAnswer` (retry) / `judgeSubmissions` (bounded-concurrency fan-out); shape-specific system prompt blocks; `JudgeVerdict` loses its `key`.
- `src/plugins/trivia/answerTypes/freeform.ts` — `processReveal` fans out per-answer, leaves unjudged rows pending, returns an error and skips the `processedAt` stamp when any row could not be scored.
- `src/plugins/trivia/core/types.ts`, `tools/questions/getQuestionHistory.ts` — drop the now-dead `judge-error` / `judge-missing-verdict` reason labels from doc strings.
- Tests: `freeform/judge.test.ts` (per-answer prompt selection, retry-then-throw, concurrency, failure→null) and `answerTypes/freeform.test.ts` (per-answer judging, date-boundary acceptance, pending-on-failure).
- Spec wording reconciliation: `trivia-reveal-processor` describes "the inline batch judge … as before" in two places — update those phrasings to "per-answer judge" so the specs don't contradict.
- No config schema changes. No data migrations. No new dependencies.
