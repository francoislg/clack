## 1. Types and schema

- [x] 1.1 Add `format?: { questions: Array<{ label?: string; categories?: string[]; questionTypes?: Record<"boolean" | "choice", number> }> }` to the `SeasonEntry` type in `src/plugins/trivia/core/types.ts`
- [x] 1.2 Add `slot?: { index: number; label?: string }` to the question record type in `src/plugins/trivia/core/types.ts`
- [x] 1.3 Add a `validateFormat(format)` helper in `src/plugins/trivia/domain/` that enforces invariants (non-empty `questions`, valid `label`/`categories`/`questionTypes` per slot)
- [x] 1.4 Add unit tests for `validateFormat` covering: empty `questions` rejected, empty `label` rejected, empty `categories` rejected, all-zero `questionTypes` rejected, unknown `questionTypes` keys rejected, empty slot `{}` accepted
- [x] 1.5 Type-check passes via `npx tsc`

## 2. upsert_season accepts format

- [x] 2.1 Extend the Zod schema in `src/plugins/trivia/tools/seasons/upsertSeason.ts` to accept an optional `format` argument (object or `null`)
- [x] 2.2 On CREATE: when `format` is provided, run `validateFormat` and store verbatim on the new entry
- [x] 2.3 On UPDATE: omit-to-keep semantics; explicit `null` clears the field; object value replaces wholesale (re-validates)
- [x] 2.4 Update the return shape to include `hasFormat: boolean` and `slotCount: number`
- [x] 2.5 Add tests for upsert_season `format` handling: create-with-format, update-replaces-format, null-clears-format, invalid-format-rejected, format-on-already-started-season-allowed
- [x] 2.6 Type-check passes via `npx tsc`

## 3. get_ideas accepts slot and returns format meta

- [x] 3.1 Extend the Zod schema in `src/plugins/trivia/tools/questions/getIdeas.ts` to accept an optional `slot: number` argument (default `0`)
- [x] 3.2 Compute the `format` meta when the active season has a `format`: `{ slotCount, slots: [{ index, label?, categories }] }` with per-slot resolved categories (slot.categories ?? season.categories)
- [x] 3.3 Validate `slot` argument against the active season's format; reject out-of-range with "slot index out of range"; reject `slot > 0` when no format with "season has no format"
- [x] 3.4 Route the source category pool through the slot's resolved pool when format is present and slot is in range
- [x] 3.5 Echo `slot` in the response so Claude can confirm which slot the suggestion is for
- [x] 3.6 Ensure each call rolls fresh `suggestedAnswer` / `suggestedDifficulty` / `suggestedType` — no caching across slot indices (existing per-call behavior preserved)
- [x] 3.7 Update tests in `src/plugins/trivia/tools/questions/getIdeas.format.test.ts` for new payload shape (format meta, slot field), per-slot pool routing, out-of-range rejection, no-format-slot-rejection
- [x] 3.8 Type-check passes via `npx tsc`

## 4. questionTypes resolution priority extended

- [x] 4.1 Update the `resolveQuestionTypes` helper (or equivalent) used by `get_ideas` to consider slot.questionTypes first when format + valid slot are present
- [x] 4.2 Cascade: slot.questionTypes → season.questionTypes → config.trivia.questionsTypes → `{ boolean: 1 }`
- [x] 4.3 Add tests for the extended priority order: slot-overrides-season, slot-empty-falls-back-to-season, no-format-uses-season-only
- [x] 4.4 Type-check passes via `npx tsc`

## 5. save_question enforces slot binding

- [x] 5.1 Extend the Zod schema in `src/plugins/trivia/tools/questions/saveQuestion.ts` to accept an optional `slot: { index: number; label?: string }` argument
- [x] 5.2 When the active season has a format: require `slot`, validate `slot.index` is in range, validate the question's type is permitted by `slot.questionTypes` (cascade), validate the category is in `slot.categories ?? season.categories`
- [x] 5.3 When the active season has no format: reject any `slot` argument with "season has no format"
- [x] 5.4 Snapshot `slot: { index, label }` onto the saved question record where `label` is taken from `format.questions[index].label` (NOT the caller's `slot.label`)
- [x] 5.5 Add tests covering: valid-slot-saves-with-snapshot, missing-slot-rejected-with-format, out-of-range-rejected, type-mismatch-rejected, category-not-in-slot-rejected, slot-rejected-without-format
- [x] 5.6 Type-check passes via `npx tsc`

## 6. Auto-continuation inheritance in process_reveal_answers

- [x] 6.1 Update the season-rollover branch in `src/plugins/trivia/tools/reveal/processRevealAnswers.ts` to deep-copy `categories`, `questionTypes`, and `format` from the closing season onto the new continuation entry
- [x] 6.2 Preserve the deterministic `slug` derivation (`season-YYYY-MM` for next month) and `expectedEndAt` rule (end-of-current-UTC-month)
- [x] 6.3 Ensure staged future seasons (entries with `startedAt > now` already on the timeline) are not replaced or modified — existing behavior preserved
- [x] 6.4 Update integration tests in `src/plugins/trivia/tools/reveal/` for: continuation-inherits-categories, continuation-inherits-questionTypes, continuation-inherits-format, continuation-absent-fields-stay-absent, staged-future-season-untouched
- [x] 6.5 Update the previous "continuation copies global baseline" test to reflect the new "deep-copy from closing season" behavior (this is the behavioral change called out in the proposal)
- [x] 6.6 Type-check passes via `npx tsc`

## 7. Rewrite SEND_QUESTIONS_INSTRUCTIONS as payload-driven loop

- [x] 7.1 In `src/plugins/trivia/prompts/scheduledPrompts.ts`, rewrite `SEND_QUESTIONS_INSTRUCTIONS` so the opening step is "call `get_ideas(game: "{game}")` and read the `format` field"
- [x] 7.2 Express two branches in the prompt: single-question (format is null) reuses today's flow; multi-slot loops over `[0, format.slotCount)` calling `get_ideas(slot: i)` then `save_question(slot: { index: i })` per slot
- [x] 7.3 Explicitly forbid pre-rolling across slots; explicitly clarify that `slot.label` is a creative hint, not literal text
- [x] 7.4 Specify duplicate-detection is game-scoped (not slot-scoped)
- [x] 7.5 End the flow with a single `post_questions({ game, items: [...] })` call carrying one item per saved question in slot order, then `submit_response({ skip_response: true })`
- [x] 7.6 Add unit tests in the trivia prompt test file: prompt-contains-format-branch, prompt-contains-slot-loop-guidance, prompt-forbids-preroll, prompt-game-scoped-duplicate-language
- [x] 7.7 Type-check passes via `npx tsc`

## 8. buildGameSpecs stability

- [x] 8.1 Audit `src/plugins/trivia/domain/buildGameSpecs.ts` to confirm it does NOT read any `seasons.json` file — fail the task if it does, refactor out
- [x] 8.2 Ensure the `<name>:question` spec's `requiredTools` includes `mcp__trivia__post_questions` (delivered by `add-trivia-post-questions-tool`) — no change if already present
- [x] 8.3 Add a regression test asserting `buildGameSpecs` output is byte-identical across two runs with the same `config.trivia.games[]` but different on-disk `seasons.json` contents
- [x] 8.4 Type-check passes via `npx tsc`

## 9. Instruction text updates

- [x] 9.1 Update the `trivia-check` instruction file (in `src/plugins/trivia/prompts/triviaCheckInstruction.ts`) to document `format` on `upsert_season` and the slot-aware question flow
- [x] 9.2 Document the auto-continuation inheritance change ("auto-rollover now repeats the closing season's setup; stage a future season to break the chain") in the same instruction file
- [x] 9.3 Note the soft recommendation of ≤10 slots per format and the slot.label-as-creative-hint guidance
- [x] 9.4 Manual sanity-check that the rendered instruction reads coherently end-to-end

## 10. End-to-end validation

- [x] 10.1 Add an integration test (`src/plugins/trivia/format.integration.test.ts`) that exercises: admin upserts a season with a 2-slot format → mock cron fires question → `get_ideas` returns format meta → save_question called twice with correct slot args → post_questions called with 2 items → question records stamped with slot.index/label
- [x] 10.2 Add an integration test for auto-rollover: closing season with a format → last-fire reveal → continuation entry has the inherited format
- [x] 10.3 Run `npm test` and confirm the full suite passes
- [x] 10.4 Run `npx oxlint src/plugins/trivia` and `npx oxfmt --check src/plugins/trivia` — fix any violations
- [x] 10.5 Run `npx tsc` one final time to confirm zero type errors

## 11. Multi-question reveal: roundSummary in process_reveal_answers

- [x] 11.1 Extend the `ProcessRevealResult` type in `src/plugins/trivia/tools/reveal/types.ts` with `roundSummary: { totalQuestions: number; perPlayer: Array<{ userId; displayName; correct; answered; roundMvp?: true }> }`
- [x] 11.2 Implement a `computeRoundSummary(reveals)` pure helper that produces the field from the already-computed `voters` data; sorted by correct desc, displayName asc; `roundMvp` flag on ties at top with `correct > 0`
- [x] 11.3 Wire `computeRoundSummary` into `process_reveal_answers` so every return path (including the empty-reveals path) populates `roundSummary`
- [x] 11.4 Add unit tests for `computeRoundSummary`: length-0 returns empty, length-1 single voter, length-N aggregation, tie produces multiple MVPs, zero-correct produces no MVPs, players with answered: 0 omitted, cheater exclusion carries through
- [x] 11.5 Type-check passes via `npx tsc`

## 12. Multi-question reveal: PROCESS_REVEAL_INSTRUCTIONS prompt branch

- [x] 12.1 In `src/plugins/trivia/prompts/scheduledPrompts.ts`, rewrite `PROCESS_REVEAL_INSTRUCTIONS` to branch explicitly on `reveals.length`
- [x] 12.2 Length-1 branch: today's verbose layout (header verdict, why-section, divider, full voter-bucket sections, context, leaderboard) — unchanged
- [x] 12.3 Length-N branch: header, ≤2-sentence per-question verdict sections, divider, "Round Summary" section from `roundSummary.perPlayer` with 🏆 on `roundMvp`, context, leaderboard
- [x] 12.4 Length-0 branch: today's "no verdict today" acknowledgement + leaderboard
- [x] 12.5 Explicit prohibition in the prompt against Claude-side counting (consume `roundSummary.perPlayer` verbatim)
- [x] 12.6 Add unit tests in the trivia prompt test file asserting the prompt contains the branch markers, the `roundSummary` instruction, the 🏆 marker, and the no-Claude-counting prohibition
- [x] 12.7 Type-check passes via `npx tsc`

## 13. Validation

- [x] 13.1 Run `openspec validate add-trivia-season-question-format --strict` and resolve any reported issues
- [x] 13.2 Update `openspec/project.md` if any project-level conventions changed (likely not — this is a scoped feature)
