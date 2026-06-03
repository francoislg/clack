## 1. Characterization gate (write first, no behavior change)

- [x] 1.1 Add `src/plugins/trivia/core/configParsers/validation.characterization.test.ts` (vitest) snapshotting current `validate*` / `normalize*` behavior: for each validator — `validateAnswersFormatMap`, `validateQuestionTypeMap`, `validatePromptMediumMap`, `validateFreeformAnswerShapeMap`, `validateContextsList`, `validateDifficultyRange`/`validateDifficultyRangesMap`/`validateTriviaDifficultyMap`, `validateDifficultyBucketWeights`/`validateTriviaDifficultyRatioMap`, `validateTriviaChoicesConfig`, `validateHintConfig`, `validateAllTimeRowMode`, `validateJudgeLeniency`, `validateFormat`, `validateSlotConfig`, `validateSlotOverrides`, and the `normalize*` functions — a table of representative inputs (one valid + every documented rejection mode) mapped to the exact `{ ok, error }` result, importing the EXISTING validators
- [x] 1.2 Run the characterization test against current code; confirm green (this captures the contract to preserve) — 66 tests passing

## 2. Shared SDK-layer leaf helper

> Implemented as a dependency-free leaf `src/plugins/zodResult.ts` (NOT inside `sdk.ts` — a value import of that barrel from the config core cycles). Shared by plugins + bot core; boundary documented in `src/plugins/CLAUDE.md`.

- [x] 2.1 Add `src/plugins/zodResult.ts` exporting `Result<T> = { ok: true; value: T } | { ok: false; error: string }`
- [x] 2.2 Add `zodErrorToResult(error, fieldLabel)` — format `error.issues` into a single joined error string with `fieldLabel.a.b[0]`-style paths matching today's labels
- [x] 2.3 Add `src/plugins/zodResult.test.ts` covering path formatting (nested object, array index, record key) and multi-issue joining — 5 tests passing

## 3. Reimplement axis validators on zod (single source of truth)

> The genuine dual-layer was the AXIS validators. They are now reimplemented as zod schemas built from short-circuiting checkers in the new `axisCheckers.ts`, wrapped by `safeParse` + `zodErrorToResult`. The `validate*` signatures are PRESERVED (they become thin adapters), so consumers and the gate are untouched. The thin `*Zod` arg schemas stay as the structural MCP-boundary schemas.

- [x] 3.1 Add `configParsers/axisCheckers.ts`: `schemaFromChecker` + `safeParseToResult` plumbing and pure checkers (`weightMapCheck`, `contextsCheck`, `rangeIssue`/`rangesMapCheck`, `perFormatCheck`, `hintCheck`, `enumCheck`, `choicesCheck`) + normalizers, all vocab passed as params (no dependency on `axes.ts`)
- [x] 3.2 Reimplement every axis `validate*` in `axes.ts` as `safeParseToResult(<schema>, raw, fieldLabel)`; remove the local `Result<T>` declaration and import it from `src/plugins/zodResult.ts`
- [x] 3.3 Split `axes.ts` to satisfy the file-size rule (checkers → `axisCheckers.ts`); keep the full public surface in `axes.ts` (constants, `validate*`, thin `*Zod`, `parseTriviaAxisBag`)
- [x] 3.4 Re-point `format.ts` `Result` import to `src/plugins/zodResult.ts` (its `validateFormat`/`validateSlotConfig`/`normalize*` already delegate axis validation to the now-zod adapters)
- [x] 3.5 Re-point the characterization test's `Result` import; confirm all 66 cases still pass byte-for-byte against the zod-backed validators

## 4. Result-type consolidation

- [x] 4.1 `domain/seasonFormat.ts`: replace its `ValidateResult<T>` declaration with an import of `Result<T>` from `src/plugins/zodResult.ts` (so there is one `Result` type across trivia config)
- [x] 4.2 Confirm tool-arg types still compile under `strict` (the thin arg schemas are unchanged; the handlers call the unchanged `validate*` adapters, so no inference drift)

## 5. Green gate

- [x] 5.1 `npx tsc` clean
- [x] 5.2 `npx oxlint` + `npx oxfmt` clean on the changed files
- [x] 5.3 `npm test` (vitest) green — full suite 5250 passing, incl. characterization gate + all consumer tests
- [ ] 5.4 `graphify update .` — DEFERRED: a concurrent session is editing the casual-talk plugin; regenerating the whole-repo graph now would bundle that work into the tracked `graphify-out/`. Run after the other session lands.

> Scope note (vs the original plan): the arg `*Zod` schemas stay thin (the tool handler must keep validating, because tool tests call handlers directly and assert labeled errors). The `validate*` functions are NOT deleted — they are the labeled-error entry point that both the strict tool path and the lenient file-load path share; they are now thin adapters over the zod schemas with no hand-rolled rule logic. `format.ts`'s slot/format orchestration + `normalize*` stay thin and delegate axis validation to the collapsed layer.
