## 1. Prerequisite

- [x] 1.1 Confirm `refactor-trivia-fake-sdk` has landed — this change needs its Map-backed `readFile`/`writeFile`, working `users.data` store, `testHelpers.saveUser`, and `primeTriviaConfig`
- [x] 1.2 Confirm the suite is green before starting

## 2. Add `createTriviaDataLayer(sdk)`

- [x] 2.1 Add `spyScoped(scoped)` enumerating all 12 `ScopedTriviaDataLayer` methods (`loadQuestions`, `saveQuestion`, `updateQuestion`, `loadAnswers`, `saveAnswer`, `updateAnswer`, `loadCheats`, `saveCheat`, `removeCheat`, `loadSeasonsState`, `saveSeasonsState`, `getCurrentSeasonSlug` — `core/types.ts:439`) via `vi.spyOn`, building the returned object from the spy return values (design D3 — no cast, no `vi.mocked()` at call sites)
- [x] 2.2 Add `createTriviaDataLayer(sdk)` running `createSdkDataLayer(sdk)` with the 6 global methods (`loadCategories`, `saveCategories`, `loadUsers`, `refreshIdentities`, `recordJoin`, `forGame`) spied the same way; return `{ dataLayer }` only — no `testHelpers` (design D5)
- [x] 2.3 Memoize `forGame(name)` by name — without it, assertions target an object the code under test never touched and pass vacuously (design D4)
- [x] 2.4 Add a type-level assertion that the fake is assignable to `TriviaDataLayer`
- [x] 2.5 Add a comment on `spyScoped` recording that internal cross-calls bypass spies by design (design D7)
- [x] 2.6 Verify with tests in a new `src/plugins/trivia/testHelpers.dataLayer.test.ts` (sibling to `testHelpers.fakeSdk.test.ts`, same contract-test style): state round-trips; spies observe; `forGame` memoizes; one method stubs while others stay real; read-after-write works; season bootstrap fires (config primed via `primeTriviaConfig(sdk, config)` in `beforeEach` — design D6); cheat tally returns `1, 2`; `recordJoin` is idempotent; an internal cross-call (e.g. `saveQuestion` reading `loadQuestions` through its closure) is NOT counted by the sibling's spy (design D7 / spec Req 3)
- [x] 2.7 Confirm `npx tsc --noEmit` and `npx oxlint` pass with no casts (design D9)
- [x] 2.8 Leave `createInMemoryDataLayer` in place — both coexist through the migration

## 3. Migrate the integration files (highest value)

Migration pattern for sections 3–5 (design D5/D6): in `beforeEach` — `const { sdk } = createFakeSdk(); primeTriviaConfig(sdk, config); const { dataLayer } = createTriviaDataLayer(sdk);` — never at module scope.

- [x] 3.1 Decide the substrate: Map (hermetic, fast) or tmpdir (catches path-construction bugs) — see design Open Questions; Map is the safe default. DECIDED: Map — a tmpdir would require a real-fs `ClackSdk` fake that doesn't exist, and buys only `games/<name>/*.json` path-assembly coverage already exercised via the Map keys
- [x] 3.2 `reveal.integration.test.ts` — move to the real layer; stub nothing
- [x] 3.3 `topical.integration.test.ts`
- [x] 3.4 `choiceFlow.integration.test.ts`
- [x] 3.5 `format.integration.test.ts`
- [x] 3.6 `tools/reveal/replayQuestion.integration.test.ts`
- [x] 3.7 `tools/questions/getIdeas.opener.integration.test.ts`
- [x] 3.8 Confirm each now exercises real behavior end to end — in particular that the season bootstrap fires where relevant, which was impossible against the fake (format + getIdeas.opener now prime seasons-enabled config and run the real bootstrap; no data-layer method stubbed in any of the six)

## 4. Migrate the read-after-write handlers

- [x] 4.1 `tools/reveal/computeAnswers.test.ts` (14 data calls — the heaviest)
- [x] 4.2 `answerTypes/freeform.test.ts` (12)
- [x] 4.3 `answerTypes/clickHandlerInstaller.test.ts` (10)
- [x] 4.4 `tools/reveal/settleQuestion.test.ts` (7)
- [x] 4.5 `tools/questions/postQuestions.test.ts` (6)
- [x] 4.6 `tools/reveal/overrideAnswer.test.ts` (5)
- [x] 4.7 `answerTypes/hintButton.test.ts` (5)
- [x] 4.7b `revealCards/{postGameButtons,seeAnswerButton,tellMeMoreButton}.test.ts`, `freeform/roster.test.ts`, `tools/cascadeParity.crossTool.test.ts` (read-after-write adjacent — migrated with the same policy)
- [x] 4.8 `tools/questions/saveQuestion.test.ts` (4)
- [x] 4.9 Delete any `mockResolvedValueOnce` chains that existed only to fake staleness — real state makes them unnecessary

## 5. Migrate the seed-then-filter files

- [x] 5.1 Convert write-path seeding to direct read programming — `await data.forGame(g).saveQuestion(q)` → `data.forGame(g).loadQuestions.mockResolvedValue([q])` (applied where the tool never writes the collection; write-seeding kept where the tool writes — recipe/D10)
- [x] 5.2 `findPreviousQuestions.*.test.ts` (5 files: base, crossGame, posted, recentBatch, seasons)
- [x] 5.3 `getIdeas.*.test.ts` (8 unit files: choice, choiceEmojiStyle, format, hint, instructions, medium, opener, points — `getIdeas.opener.integration.test.ts` is covered by task 3.7)
- [x] 5.4 `saveQuestion.*.test.ts` (8 variant files: choiceEmojiStyle, choices, hint, judgeLeniency, media, points, prediction, slot — the base `saveQuestion.test.ts` is covered by task 4.8)
- [x] 5.5 `tools/seasons/*.test.ts` (12 files — all of them consume `createInMemoryDataLayer`)
- [x] 5.6 Confirm each test now passes without depending on an unrelated write method working

## 6. Migrate the remaining seed/sink files

- [x] 6.1 Decide whether to continue — this group gains least (assertions are on the return envelope; the layer is incidental). Stopping here with both helpers coexisting is an acceptable resting state, not a broken one (design Risks). DECIDED: continue — the tail was cheap at migration time, and finishing it unlocks section 7 (deleting the second implementation), which is the change's headline goal
- [x] 6.2 If continuing: migrate the remaining files, converting `await data.saveCategories([...])` → `data.loadCategories.mockResolvedValue([...])`
- [x] 6.3 Resolve the cheat-tally scope question — `saveCheating.test.ts` / `removeCheat.test.ts` arguably should stub `saveCheat` and assert only the tool's handling, since the tally is `dataLayer.test.ts`'s claim (design Open Questions). RESOLVED: keep the real tally as the coherent default — the tool tests assert the tool's envelope (which surfaces `totalAttempts`), never the tally algorithm itself; the tally's own claim lives in `testHelpers.dataLayer.test.ts` and the layer's unit tests, and per D8 stubbing `saveCheat` stays available per test if a claim ever needs isolation

## 7. Remove the second implementation

- [x] 7.1 Confirm zero remaining consumers of `createInMemoryDataLayer`
- [x] 7.2 Delete `createInMemoryDataLayer` and the `InMemoryDataLayer` type
- [x] 7.3 Confirm the four test-only seams are gone with it: `saveUser`, `saveUsers`, `getUserData`, and the `resolveIdentity` constructor option
- [x] 7.4 Confirm no `TriviaDataLayer & { … }` intersection remains anywhere in test code

## 8. Documentation and close-out

- [x] 8.1 Document in CLAUDE.md's Test Conventions: substrate chooses scope — unit stubs what its claim depends on, integration stubs nothing; both use the same fakes (design D8)
- [x] 8.2 Document: seed by programming the read, never by invoking an unrelated write
- [x] 8.3 Confirm the guard test (rescoped in `refactor-trivia-fake-sdk`) catches any hand-rolled data layer stub introduced during migration (guard updated: `InMemoryDataLayer` → `FakeTriviaDataLayer`/`FakeScopedTriviaDataLayer` in COLLABORATOR_TYPES, `createInMemoryDataLayer` → `createTriviaDataLayer` in CANONICAL_FACTORIES; two hand-rolled patterns found and replaced during migration — computeAnswers' decorator wrapper and predictions' `FAKE_REACTIONS` literal)
- [x] 8.4 Run `npx tsc --noEmit`, `npx oxlint src/plugins/trivia`, `npx oxfmt`, and the full `npm test` (453 files / 7202 tests passed; all checks clean)
- [x] 8.5 Confirm `domain/`'s 23 fake-free test files are untouched — they are the model, not the target
