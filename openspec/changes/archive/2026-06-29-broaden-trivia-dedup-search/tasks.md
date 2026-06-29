## 1. Handler haystack method

- [x] 1.1 Add `keywordHaystack(question: TriviaQuestion): string[]` to the `AnswerTypeHandler` interface in `src/plugins/trivia/answerTypes/types.ts`, documented as "answer-bearing text folded into `find_previous_questions` keyword matching; MUST NOT include the `statement` (the tool prepends it) and is searched-only (never surfaced in responses)."
- [x] 1.2 Implement `keywordHaystack` in `boolean.ts` → returns `[]`.
- [x] 1.3 Implement `keywordHaystack` in `choice.ts` → returns `[...(question.choices ?? [])]`.
- [x] 1.4 Implement `keywordHaystack` in `freeform.ts` → returns `[question.expectedAnswer, ...(question.acceptableAnswers ?? []), question.gradingNotes].filter((s): s is string => typeof s === "string" && s.length > 0)`.
- [x] 1.5 Add/extend unit tests in `boolean.test.ts`, `choice.test.ts`, `freeform.test.ts` asserting each handler's `keywordHaystack` output (including the empty/absent-field cases).

## 2. Broaden the search tool

- [x] 2.1 In `findPreviousQuestions.ts`, build a per-row lowercased haystack `[statement, ...(q.promptMedium === "image" && q.media ? [q.media.title, q.media.altText] : []), ...getAnswerTypeHandler(q.answersFormat).keywordHaystack(q)]` and change the `keywords` filter predicate (currently `q.statement.toLowerCase().includes(kw)`) to test each keyword as a substring of any haystack entry. The `media` text is assembled by the tool (orthogonal to `answersFormat`), not by the handler.
- [x] 2.2 Update `computeMatchedKeywords` to test against the same haystack rather than `statement` alone.
- [x] 2.3 Update the `keywords` zod `.describe(...)` text to state it matches against the statement, image `media.title`/`media.altText`, choice options, and freeform answer fields (and that `category` is matched only via `categories`).
- [x] 2.4 Confirm the response projection (`toSearchResult` / `buildSearchResult`) is unchanged — freeform answer fields stay excluded, `choices` stay included.

## 3. Update the duplicate-check prompt

- [x] 3.1 In `scheduledPrompts.ts`, revise `DUPLICATE_CHECK_GATE`: mandate the **primary subject** keyword (the entity that varies within the category, not the template words), include the **answer** as a recall aid, and state that a shared answer in a different context is NOT a duplicate. Remove the over-strong "necessarily shares both subject and answer" assertion.
- [x] 3.2 Update `scheduledPrompts.test.ts` gate assertions to match the new wording (subject mandate, answer-as-recall-aid, not-a-verdict clause); keep the existing `keywords: [` / `match: "any"` / `OMIT the games argument` assertions green.

## 4. Tool tests

- [x] 4.1 In `findPreviousQuestions.test.ts`, add: keyword matches a choice option absent from the statement → row returned with `matchedKeywords`.
- [x] 4.2 Add: keyword matches a freeform `expectedAnswer`/`acceptableAnswers`/`gradingNotes` absent from the statement → row returned, and the returned row carries NO `expectedAnswer`/`acceptableAnswers`/`gradingNotes` (no answer-key leak).
- [x] 4.3 Add: boolean text row matches only via statement (no answer-bearing haystack contribution).
- [x] 4.4 Add: image-medium question matches via `media.title`/`media.altText` when the keyword is absent from its templated statement (cross-medium dedup); a text row reads no media fields.
- [x] 4.5 Add: `keywords: ["<category word>"]` with no `categories` argument does NOT match a row solely by its `category`.

## 5. Verify

- [x] 5.1 `npx tsc --noEmit` clean.
- [x] 5.2 `npx vitest run src/plugins/trivia/answerTypes src/plugins/trivia/tools/questions src/plugins/trivia/prompts` all green.
- [x] 5.3 `npx oxlint` + `npx oxfmt --check` clean on touched files.
- [x] 5.4 `openspec validate broaden-trivia-dedup-search --strict` passes.
