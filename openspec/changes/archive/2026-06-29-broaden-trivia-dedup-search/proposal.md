## Why

Trivia question generation produces near-duplicates because the duplicate-detection gate cannot reliably surface prior questions. `find_previous_questions` matches keywords only against a row's `statement`, so a keyword drawn from the *answer* (e.g. a country in a `choice` question's options, or a freeform `expectedAnswer`) matches nothing — exactly the terms a generator would use to check "have I asked about this before?". The gate's verdict is sound (Claude inspects returned statements semantically); the recall feeding it is too narrow, so duplicates slip through silently.

## What Changes

- **Broaden keyword matching** in `find_previous_questions` from `statement`-only to a per-row haystack of `statement` + (image-medium) `media.title`, `media.altText` + (choice) `choices[]` + (freeform) `expectedAnswer`, `acceptableAnswers[]`, `gradingNotes`. Boolean text rows contribute only their `statement` (the subject lives there). The answer-format-specific text (choice options, freeform answer fields) is built by the answer-type handler — no `answersFormat ===` branching in the tool; the format-agnostic base (`statement`, plus `media` text when `promptMedium === "image"`) is prepended by the tool, so image-medium questions become discoverable by the *text* dedup path (cross-medium dedup — a text and an image question about the same subject find each other).
- **`matchedKeywords`** is computed against the same broadened haystack (so a keyword that hits only via a choice option still reports as matched).
- **No answer-key leak**: the freeform answer fields are searched but, per the existing answer-key-exclusion requirement, remain absent from the returned rows. `choices` continue to be returned (already not the answer key).
- **Category stays an optional drill-down** criterion, NOT folded into the keyword haystack; duplicate detection remains cross-category and cross-game by default. (A row's `category` is matched only via the explicit `categories` argument.)
- **Update the DUPLICATE CHECK GATE prompt** so: the **primary subject / framing** is the duplication discriminator Claude must search on; the **answer** is included as a *recall aid* to widen the candidate net, but a shared answer in a *different context* is explicitly NOT a duplicate (the gate's existing "same underlying fact in any framing" judgment governs). This corrects an over-strong line currently asserting a repeat "necessarily shares both subject and answer."

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `trivia-question-search`: the `keywords` criterion and `matchedKeywords` projection match against the row's `statement` plus its image `media` text (`title`, `altText`) and its answer-type-specific text (choice options; freeform expected/acceptable/grading fields), not `statement` alone. Answer-key exclusion from the response is unchanged.
- `trivia-scheduled-prompts`: the question-posting prompt's duplicate-check step mandates the primary subject as a keyword and treats the answer as a recall aid (not a duplication verdict).

## Impact

- `src/plugins/trivia/answerTypes/types.ts` — new `keywordHaystack(question): string[]` method on `AnswerTypeHandler`.
- `src/plugins/trivia/answerTypes/*` — per-handler `keywordHaystack` implementations (boolean `[]`, choice `[...choices]`, freeform `[expectedAnswer, ...acceptableAnswers, gradingNotes].filter(Boolean)`).
- `src/plugins/trivia/tools/questions/findPreviousQuestions.ts` — filter + `computeMatchedKeywords` use the haystack; the tool prepends `statement` and (for `promptMedium === "image"` rows) `media.title` + `media.altText` to the handler's answer-format text; `keywords` param description updated.
- `src/plugins/trivia/prompts/scheduledPrompts.ts` — `DUPLICATE_CHECK_GATE` wording.
- Tests: `findPreviousQuestions.test.ts` (matching across choices/freeform answers, no answer-key leak), `scheduledPrompts.test.ts` (gate assertions).
- No data migration: stored records are read-only here; no schema change.
