## Context

`find_previous_questions` is the duplicate-detection backstop during trivia question generation. Today its `keywords` criterion matches only against each row's `statement` (`findPreviousQuestions.ts`, `q.statement.toLowerCase().includes(kw)`). The answer of a `choice` question lives in `choices[correctIndex]`, and a `freeform` answer lives in `expectedAnswer` / `acceptableAnswers` / `gradingNotes` — none of which are in `statement`. So a generator that searches the answer term to check for repeats matches nothing, and near-duplicates ship.

The scan already covers all history (the `limit` truncates only the returned list, not the filter), and the gate's verdict is sound — Claude semantically inspects returned statements. The defect is purely **recall**: too few candidate rows reach Claude.

A parallel already exists on the image path: visual questions stamp a structured `subjectId` and dedup via `find_previous_subjects` (exact match). Text questions have no structured subject; their subject is implicit in free text. This change does not introduce a subject ledger — it widens the existing lexical search to cover answer-bearing fields.

## Goals / Non-Goals

**Goals:**
- Keyword search matches a per-row haystack: `statement` + image `media` text (`title`, `altText`) + answer-type-specific text (choice options; freeform expected/acceptable/grading), maximizing recall.
- `matchedKeywords` computed against the same haystack.
- Answer-type-specific haystack assembly owned by the `AnswerTypeHandler`, not by `answersFormat ===` branching in the tool. The format-agnostic base (`statement`, `media` text) is owned by the tool, not the handler.
- Cross-medium dedup: an image-medium question is discoverable by the text dedup path (a text and an image question about the same subject find each other).
- No regression to the answer-key-exclusion guarantee: freeform answer fields are searched but never returned; `choices` continue to be returned (not the answer key).
- The duplicate-check prompt mandates the primary subject as a keyword and frames the answer as a recall aid, not a duplication verdict.

**Non-Goals:**
- No structured `subject`/`topic` field on text records (no schema change, no migration).
- No generation-time "recently-used subjects/answers" surfacing through `get_ideas` (a larger diversity-pressure change, deferred).
- No change to scoring, posting, reveal, or the `find_previous_subjects` image path.
- No change to the `categories` / `seasons` / `posted` / `recentBatchFromNow` criteria.

## Decisions

**1. Add `keywordHaystack(question): string[]` to `AnswerTypeHandler`.**
Each handler returns its answer-bearing strings: boolean `[]`, choice `[...choices]`, freeform `[expectedAnswer, ...(acceptableAnswers ?? []), gradingNotes].filter(Boolean)`. The tool builds `haystack = [statement, ...handler.keywordHaystack(q)]`, lowercases once, and both the filter predicate and `computeMatchedKeywords` test each keyword as a substring of any haystack entry.
- *Why on the handler:* the repo rule "AnswerTypeHandler owns format logic — no `answersFormat ===` branching in consumers." This mirrors the existing `buildSearchResult` method, which already lives on the handler for the same reason.
- *Alternative considered:* inline switch in the tool — rejected, violates the rule and scatters format knowledge.

**2. Media text is added by the tool, not the handler.**
`promptMedium` (text vs image) is orthogonal to `answersFormat` — an image question can be boolean, choice, or freeform. So `media.title` + `media.altText` are NOT answer-format-specific and do not belong on `keywordHaystack`. The tool builds `haystack = [statement, ...(q.promptMedium === "image" && q.media ? [q.media.title, q.media.altText] : []), ...handler.keywordHaystack(q)]`. This keeps the handler purely answer-format text and avoids each of the three handlers duplicating media logic (and a `promptMedium ===` branch inside every handler).
- *Why include media at all:* image-medium questions store their subject in `media.title` ("Eiffel Tower"), not `statement` (which is a templated "Which landmark is shown?"). Without it, a text-path dedup search never sees a prior image question on the same subject. (Image generation still dedups via `find_previous_subjects` on `subjectId`; this is the complementary text→image direction.)
- *Alternative considered:* add media to each handler's `keywordHaystack` — rejected, forces a `promptMedium` branch into every handler and duplicates the logic three times.

**3. Category stays out of the haystack.**
`category` is matched only via the explicit `categories` criterion. Folding it in would make `keywords: ["geography"]` hit every geography row (noise) and, worse, implicitly scope dedup by category — the opposite of the desired cross-category dedup.
- *Why:* the same question reused under a different category label must still be caught; default duplicate detection stays cross-category and cross-game.

**4. Answer is a recall aid, not a verdict (prompt).**
The duplicate-check step mandates the *primary subject* (the entity the question hinges on, not the shared template words) and adds the *answer* to widen the net, but explicitly states that a shared answer in a different context is not a duplicate. This corrects an over-strong line in the current `DUPLICATE_CHECK_GATE` asserting a repeat "necessarily shares both subject and answer" — false for a game like geography where the same country recurs across unrelated questions.

**5. No data migration.**
The change reads existing fields at search time. Legacy rows (missing `answersFormat`, etc.) already resolve through `getAnswerTypeHandler(q.answersFormat)` (absent ⇒ boolean), so `keywordHaystack` returns `[]` for them and behavior degrades to statement-only — identical to today.

## Risks / Trade-offs

- **Broader recall can let a loose keyword bury an old real duplicate behind 20 newer loose matches (the `limit` cap).** → The gate already instructs "if uninformatively wide, re-call with sharper keywords"; the prompt update reinforces retaining the primary subject. Acceptable per the stated preference: "better to return 20 candidates Claude can ignore than to miss one."
- **More false-positive candidates increase Claude's per-generation inspection cost.** → Bounded by `limit` (default 20) and the sharpen-keywords instruction; the verdict step is unchanged.
- **Accidentally surfacing freeform answer fields in the response would leak the answer key.** → The response projection (`toSearchResult` + `buildSearchResult`) is untouched; only the match predicate reads the extra fields. A test asserts a freeform row matched via `expectedAnswer` returns no answer-key fields.
