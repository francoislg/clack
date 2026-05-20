## 1. Migration

- [x] 1.1 Scaffold a new blocking boot migration via `/create-migration` (never create migration files manually — the skill registers and tests them)
- [x] 1.2 Migration step: read `data/config.json`; when `trivia.questionsTypes` is present, rename the key to `trivia.answersFormat` (values unchanged); write back atomically
- [x] 1.3 Migration step: for every `data/plugins/trivia/games/*/questions.json`, rename `type` → `answersFormat` on every record; when `answersFormat` is now undefined (legacy boolean rows), set it to `"boolean"`; always stamp `questionType: "fact"` on every existing record
- [x] 1.4 Migration step: for every `data/plugins/trivia/games/*/seasons.json`, rename `questionsTypes` → `answersFormat` on each `SeasonEntry`; for each `SeasonFormatSlot` inside `format.questions`, rename `questionTypes` → `answersFormat`
- [x] 1.5 Migration step: bump `data/state/migration-version.json` (handled by `boot.ts` `writeVersion(migration.version)` after the static transform succeeds — no per-migration code needed)
- [x] 1.6 Write unit tests for the migration: pure transforms for config, question row, season entry, seasons file; idempotency tested at the seasons-file level (running twice is a no-op)
- [x] 1.7 Register the migration in the boot migration runner; verify it runs before plugin load

## 2. Config schema

- [x] 2.1 Update `src/config.ts` `Config` type: rename `trivia.questionsTypes` → `trivia.answersFormat`; add `trivia.questionType?: Record<"fact" | "topical", number>`; add `trivia.contexts?: Array<{ name: string; weight?: number }>`
- [x] 2.2 Update config Zod validator: same shape changes; validate `answersFormat` (same rules as old `questionsTypes`), validate `questionType` (only keys `fact`/`topical`, at least one positive weight), validate `contexts` (non-empty when present, unique names, positive weights)
- [x] 2.3 Update `DEFAULT_TRIVIA_CHOICES` exports — unchanged in value; add a `DEFAULT_QUESTION_TYPE_WEIGHTS = { fact: 1, topical: 0 }` analogue for the questionType axis
- [x] 2.4 Update every reference to `config.trivia.questionsTypes` in source to `config.trivia.answersFormat`
- [x] 2.5 Add config-load tests for all three new validation paths (`answersFormat` rename round-trip, `questionType` validation, `contexts` validation)

## 3. Core types and data layer

- [x] 3.1 In `src/plugins/trivia/core/types.ts`: rename `TriviaQuestion.type` → `TriviaQuestion.answersFormat`; add required `questionType: "fact" | "topical"` field on `TriviaQuestion`; add optional `context?: string`, `sourceUrl?: string`, `eventDate?: string`
- [x] 3.2 Update `SeasonEntry`: rename `questionTypes` → `answersFormat`; add `questionType?: SeasonQuestionTypeWeights` (with new `Record<"fact" | "topical", number>` type alias); add `contexts?: ContextEntry[]` (with new `ContextEntry = { name: string; weight?: number }` type alias)
- [x] 3.3 Update `SeasonFormatSlot`: same shape changes — rename `questionTypes` → `answersFormat`, add `questionType?`, add `contexts?`
- [x] 3.4 Update `SeasonQuestionTypeWeights` to be `Record<"boolean" | "choice", number>` (renamed conceptually); introduce `SeasonAnswersFormatWeights = SeasonQuestionTypeWeights` as the canonical name; introduce `SeasonFactTopicalWeights = Record<"fact" | "topical", number>`
- [x] 3.5 Add type tests verifying the discriminated `TriviaQuestion` shape (boolean-format records lack choices/correctIndex; choice-format records lack isTrue; topical records carry sourceUrl)

## 4. questionType + context resolution domain

- [x] 4.1 Rename `src/plugins/trivia/domain/questionTypes.ts` → split into `answerFormats.ts` (boolean vs choice axis, formerly questionTypes.ts) and a new `factTopical.ts` (the new fact-vs-topical axis); both export the same shape of resolver function over the cascade (slot → season → config → default)
- [x] 4.2 Implement `resolveAnswersFormat(currentSeason, slotIndex, config)` in `answerFormats.ts` — mirror the existing `resolveQuestionTypes` logic with the renamed fields; default `{ boolean: 1, choice: 0 }`
- [x] 4.3 Implement `resolveQuestionType(currentSeason, slotIndex, config)` in `factTopical.ts`; default `{ fact: 1, topical: 0 }`
- [x] 4.4 Implement `src/plugins/trivia/domain/contexts.ts` with: `resolveContexts(currentSeason, slotIndex, config): ContextEntry[] | null` and `rollContextPriority(contexts: ContextEntry[]): string[]` — the latter does weighted random sampling without replacement
- [x] 4.5 Tests for `resolveAnswersFormat`: full cascade coverage (slot wins, season wins, config wins, default wins)
- [x] 4.6 Tests for `resolveQuestionType`: same cascade coverage
- [x] 4.7 Tests for `resolveContexts`: cascade coverage + the "absent at every tier → null" case
- [x] 4.8 Tests for `rollContextPriority`: returns a permutation, statistical bias matches weights (1000-iter property test), each call rolls independently, empty-string entry handled

## 5. get_ideas tool

- [x] 5.1 Update `src/plugins/trivia/tools/questions/getIdeas.ts` description text: document `suggestedAnswersFormat` (renamed), `suggestedQuestionType` (new), `contextPriority` (new, conditional)
- [x] 5.2 Update response shape: emit `suggestedAnswersFormat` (rename of `suggestedType`), `suggestedQuestionType` (new), `contextPriority` (only when contexts resolved)
- [x] 5.3 Wire `resolveQuestionType` into the call site; roll `suggestedQuestionType` independently of `suggestedAnswersFormat`
- [x] 5.4 Wire `resolveContexts` + `rollContextPriority`; omit `contextPriority` from the response when resolveContexts returns null
- [x] 5.5 Existing choice-path conditional (suggestedChoiceCount + suggestedCorrectIndex) keeps working but reads `suggestedAnswersFormat === "choice"`
- [x] 5.6 Update `getIdeas.ts` tests to assert the new response shape; add tests for: independent axis rolls (statistical), contextPriority absence when no contexts, contextPriority permutation when present
- [x] 5.7 Update `getIdeas.choice.test.ts` and `getIdeas.format.test.ts` to use the renamed field

## 6. save_question tool

- [x] 6.1 Update `src/plugins/trivia/tools/questions/saveQuestion.ts` Zod schema: `answersFormat` (required, replaces `type`); `questionType` (required, `"fact" | "topical"`); optional `sourceUrl: string`, `eventDate: string`, `context: string`
- [x] 6.2 Implement validation: `sourceUrl` required iff `questionType === "topical"`; `sourceUrl` must be `https://`-prefixed; `eventDate` only permitted when topical; `eventDate` must match `YYYY-MM-DD`
- [x] 6.3 Implement context validation: resolve active contexts for this question's slot/season/config; reject non-empty context not in the list; reject any context arg when no contexts configured; empty-string context omits the field from the stored record
- [x] 6.4 Update slot binding (when active season has a `format`): cascade-resolve `answersFormat` / `questionType` / `categories` / `contexts` for the slot; reject answersFormat/questionType not permitted by slot; reject category not in slot pool; reject context not in slot lens list
- [x] 6.5 Update the returned/saved record shape to include `answersFormat`, `questionType`, and conditionally `context`, `sourceUrl`, `eventDate`
- [x] 6.6 Update `saveQuestion.test.ts`: rename all `type` references; add tests for the new validations (sourceUrl required, sourceUrl HTTPS only, eventDate ISO, eventDate only-with-topical, context validation against active list, context absence when no contexts configured)
- [x] 6.7 Update `saveQuestion.slot.test.ts`: rename references, add tests for slot's `questionType` / `contexts` enforcement

## 7. find_previous_questions and get_question_history

- [x] 7.1 In `findPreviousQuestions.ts`: include `answersFormat`, `questionType`, `context?`, `sourceUrl?`, `eventDate?` in the response payload (continue excluding `isTrue` and `correctIndex`)
- [x] 7.2 In `getQuestionHistory.ts`: include `answersFormat`, `questionType`, `context?`, `sourceUrl?`, `eventDate?` in the response payload alongside the existing answer-key fields
- [x] 7.3 Update `findPreviousQuestions.test.ts` and `getQuestionHistory.test.ts` for the new field set

## 8. upsert_season tool

- [x] 8.1 Update `src/plugins/trivia/tools/seasons/upsertSeason.ts`: rename `questionTypes` arg → `answersFormat`; add `questionType` arg; add `contexts` arg; same omit-to-keep / null-to-clear semantics across all three
- [x] 8.2 Update validators for `answersFormat` (same as renamed), `questionType` (new), `contexts` (new) — all-zero weights, unknown keys, empty array, duplicate names
- [x] 8.3 Update the slot-shape validator in `format.questions[]` to accept the new optional `answersFormat`, `questionType`, `contexts` fields per slot
- [x] 8.4 Update return shape: rename `hasQuestionTypes` → `hasAnswersFormat`; add `hasQuestionType` and `hasContexts`
- [x] 8.5 Update `upsertSeason.test.ts`: rename refs; add coverage for each new field's create / update / clear / validation-rejection paths

## 9. Reveal flow

- [x] 9.1 In `src/plugins/trivia/tools/reveal/processRevealAnswers.ts`: read `answersFormat` (renamed) instead of `type` throughout — verdict shape, answer-key carry, multi-react void rules
- [x] 9.2 `questionType` does NOT affect reveal — no code changes needed in the reveal payload assembly, but add a regression test that a topical question reveals identically to its fact sibling of the same answersFormat
- [x] 9.3 (Optional polish, deferred unless trivial) Add `sourceUrl` to reveal payload when the resolved question is topical — for future use in the verdict section
- [x] 9.4 Update `processRevealAnswers.test.ts` for the rename and the new topical-equivalence regression test

## 10. post_questions tool

- [x] 10.1 In `src/plugins/trivia/tools/questions/postQuestions.ts`: read `answersFormat` (renamed) when determining the auto-reaction set
- [x] 10.2 Update `postQuestions.test.ts` for the rename; add a regression test that a topical question gets the same reactions as a fact question of the same shape

## 11. Scheduled prompts (4-way generation flow)

- [x] 11.1 In `src/plugins/trivia/prompts/scheduledPrompts.ts`: rename every `suggestedType` reference to `suggestedAnswersFormat`; rename every prompt mention of `type` (when referring to the discriminator field) to `answersFormat`
- [x] 11.2 Refactor the existing `QUESTION_FLOW_STEPS` (boolean) and `CHOICE_FLOW_STEPS` to read as the *fact* boolean and choice paths — content essentially unchanged
- [x] 11.3 Add `TOPICAL_BOOLEAN_FLOW_STEPS` — opens with a WebSearch research step that iterates over `contextPriority` (or no-lens when absent), then composes with the fact-boolean polarity gate / duplicate check / difficulty gate
- [x] 11.4 Add `TOPICAL_CHOICE_FLOW_STEPS` — opens with a WebSearch research step that iterates over `contextPriority` (or no-lens when absent), then composes with the fact-choice distractor plausibility gate / duplicate check / difficulty gate
- [x] 11.5 Update the outer dispatcher in `SEND_QUESTIONS_INSTRUCTIONS` to branch on `suggestedAnswersFormat` × `suggestedQuestionType` (four explicit paths)
- [x] 11.6 Add instructions to use `sourceUrl` capture, optional `eventDate`, and `context` argument when saving topical questions
- [x] 11.7 Add instruction: when `contextPriority` is exhausted with no good question found, re-call `get_ideas` to re-roll
- [x] 11.8 Update prompt-rendering tests (`scheduledPrompts.test.ts`, `scheduledPrompts.choice.test.ts`) for the rename; add `scheduledPrompts.topical.test.ts` covering the four-way dispatch presence and the WebSearch / sourceUrl / contextPriority mentions

## 12. Plugin wiring and SDK glue

- [x] 12.1 No new MCP tools to register; verify `src/plugins/trivia/index.ts` still wires everything correctly with the renamed types
- [x] 12.2 Verify `WebSearch` is in the Claude scheduled-run tool list (`src/claude/index.ts:442`) — no changes needed, but a one-line existing-state test guards against regression
- [x] 12.3 Confirm `buildGameSpecs.ts` requiredTools list does NOT include `WebSearch` (built-in, globally allowed); add a comment explaining the omission

## 13. End-to-end and integration

- [x] 13.1 Update `src/plugins/trivia/format.integration.test.ts` for the rename + new fields where applicable
- [x] 13.2 Update `src/plugins/trivia/choiceFlow.integration.test.ts` for the rename
- [x] 13.3 Add a new integration test: full topical-choice generation flow with a stubbed `get_ideas` returning `suggestedQuestionType: "topical"` and a configured `contextPriority`
- [x] 13.4 Add a new integration test: questionType "topical" with no contexts configured → contextPriority omitted, WebSearch path still runs

## 14. Verification

- [x] 14.1 Run `npx tsc` — verify no type errors across the codebase
- [x] 14.2 Run `npm test` — verify all unit + integration tests pass
- [x] 14.3 Run `npx oxlint src/` — verify no lint errors
- [x] 14.4 Run `npx oxfmt --check src/` — verify formatting clean
- [x] 14.5 Run `openspec validate add-trivia-topical-questions --strict` — verify the proposal passes spec validation
- [x] 14.6 Manually inspect a fresh sample `data/` after running the migration on a fixture from before this change — verify field renames and questionType stamps land correctly

## 15. Documentation

- [x] 15.1 Update `CLAUDE.md` `### Trivia plugin: optional Seasons` section to mention the new `answersFormat` / `questionType` / `contexts` fields and the topical generation path
- [x] 15.2 Document the new config fields with short examples in the project's runbook / configuration-files index where existing trivia config is documented
- [x] 15.3 Add a brief admin-facing note in the relevant instruction file (under `data/default_configuration/admin/`) explaining how to enable topical questions and configure contexts
