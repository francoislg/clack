# Tasks: refactor-trivia-answering-strategy

## 1. Strategy module

- [x] 1.1 Create `src/plugins/trivia/answering/types.ts` — `AnsweringStrategy` interface (six members per design D1), `OwnerLabelDeps`, doc comments stating the ownership-axis rule (no answering-mode branching in consumers)
- [x] 1.2 Create `src/plugins/trivia/answering/individual.ts` — `createIndividualAnswering(scoped, data)` factory: upsert-by-`(userId, questionId)` in `answer` (timestamp bump on update; append + `recordJoin` + `refreshIdentities` on first write), pass-through projections, `applyVerdict` → `updateAnswer`, `ownerLabel` → `renderPlayerRef` semantics
- [x] 1.3 Create `src/plugins/trivia/answering/individual.test.ts` against the canonical `createTriviaDataLayer` fake — upsert vs first-write side effects, projection pass-through, verdict flip, ownerLabel with tagPlayers true/false

## 2. Write-site migration

- [x] 2.1 Migrate `answerTypes/clickHandlerInstaller.ts` — replace the `loadAnswers().find(...)` + `saveAnswer`/`updateAnswer` block (lines ~166–186) with `getCurrentAnswerFor` + `answer`; construct the strategy after game resolution
- [x] 2.2 Migrate `answerTypes/freeform.ts` modal-submit persistence (~:511) and modal prefill lookup (~:440) to `getCurrentAnswerFor` + `answer`
- [x] 2.3 Update `clickHandlerInstaller` and freeform interaction tests for the new wiring WITHOUT changing behavioral assertions (red flag rule from design D5)

## 3. Verdict-write migration

- [x] 3.1 Thread `strategy` into `ProcessRevealDeps` (and `ProjectRevealDeps` where reads move) in `answerTypes/types.ts`; update `computeAnswers.ts` deps construction
- [x] 3.2 Migrate freeform judging verdict flips (`freeform.ts:276` — the `updateAnswer(...correct...)` inside `processReveal`; NOT the `:240`/`:308` reads, which are read-site migrations under task 4.2) to `applyVerdict`
- [x] 3.3 Migrate boolean/choice reprocess re-derivation writes (`boolean.ts`, `choice.ts`) to `applyVerdict`
- [x] 3.4 Migrate `tools/reveal/settleQuestion.ts` row loading + verdict stamping to `getFinalAnswers` + `applyVerdict`

## 4. Scoring-view read migration

- [x] 4.1 Migrate `freeform/roster.ts:263` to `getFinalAnswers`
- [x] 4.2 Migrate per-question reveal reads in `boolean.ts:148/:177`, `choice.ts:238/:271`, `freeform.ts:240/:308` to `getFinalAnswers`
- [x] 4.3 Migrate game-wide reads: `tools/reveal/computeAnswers.ts:248/:370` and `tools/answers/retrieveScores.ts:55` to `getAllScoredAnswers`
- [x] 4.4 Verify audit-view sites untouched: `overrideAnswer.ts`, `getQuestionHistory.ts`, cheat paths, `seeAnswerButton.ts` still read raw rows

## 5. Guard + verification

- [x] 5.1 Add guard test (per design D5): scoring-view files listed in design D3 must not call `loadAnswers()` directly; the explicit audit-view allowlist is exactly the three answer-reading audit files — `tools/reveal/overrideAnswer.ts`, `tools/questions/getQuestionHistory.ts`, `revealCards/seeAnswerButton.ts` (the cheat tools read `cheats.json`, not answers, so they are out of scope)
- [x] 5.2 Run full suite (`npm test`) — zero existing assertion changes; `npx tsc`; `npx oxlint` + `npx oxfmt` on touched files
- [x] 5.3 Run `graphify update .` to refresh the knowledge graph
