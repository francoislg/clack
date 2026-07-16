## 1. Type machinery

- [x] 1.1 Add `AnyFn`, `Mocked<T>`, and a `MockedSdkKeys` union to `testHelpers.ts` listing every collaborator member — omitting `t`, `actionId`, `viewCallbackId`, and `capabilities`
- [x] 1.2 Define `FakeSdk = ClackSdk & { [K in MockedSdkKeys]: Mock<Extract<ClackSdk[K], AnyFn>> }` (intersection, not a replacing mapped type — see design D1)
- [x] 1.3 Add a type-level guard test asserting `FakeSdk` is assignable to `ClackSdk`, and that `sdk.t.mockReturnValue` / `sdk.actionId.mockReturnValue` are compile errors via `@ts-expect-error`
- [x] 1.4 Verify `npx tsc --noEmit` passes with no casts (design D7 — no `as unknown` / `as never` / `Record<string, unknown>` / `) as X`)

## 2. Rewrite `createFakeSdk`

- [x] 2.1 Change the return to `{ sdk, testHelpers }`; keep the `overrides` parameter working for now (see design Open Questions)
- [x] 2.2 Back `readFile` / `writeFile` with an in-memory `Map<string, string>`; expose it as `testHelpers.files`
- [x] 2.3 Keep `readFileOrSeed`'s real delegation, bound via closure over the store rather than `this` (design D5)
- [x] 2.4 Wrap every `MockedSdkKeys` member in `vi.fn(currentDefaultImpl)` — behavior-identical, enumerated explicitly (design D7)
- [x] 2.5 Replace `watchFile`'s `throw` with a no-op returning a benign watcher — it currently blocks plugin boot entirely
- [x] 2.6 Wrap `logger`'s four methods (`debug`, `info`, `warn`, `error`) in `vi.fn()`
- [x] 2.7 Memoize `registerMcpServer(name)` so repeated calls return the same handle; make the handle's `registerTool` / `addTopicInstruction` mocks (design D3)

## 3. Fold in users and memory

- [x] 3.1 Inline `fakeSdkUsers` into `createFakeSdk` with an identity `Map`; expose `testHelpers.saveUser` — modelling core populating the registry, not a back door (design D4)
- [x] 3.2 Implement `users.data<T>` with an unconstrained `<T,>`, `schema.parse` on read, and a `Map<string, object>` store — no cast, and `<T extends object>` will NOT compile (design D6)
- [x] 3.3 Back `users.data(schema)` with one shared store per fake — fresh accessor per call exactly like production (`sdkUsers.ts:44`); cast-free accessor memoization is type-impossible and unnecessary (see design D3)
- [x] 3.4 Inline `fakeSdkMemory` the same way, with `memory.data(schema)` accessors sharing one backing store
- [x] 3.5 Add tests: cheat tally returns `1, 2` across two `saveCheat` calls; `recordJoin` is idempotent; `readFileOrSeed` seeds then preserves
- [x] 3.6 Delete `fakeSdkUsers` and `fakeSdkMemory` once `core/configBridge.integration.test.ts` (their only direct consumer) is migrated

## 4. Add `primeTriviaConfig`

- [x] 4.1 Add canonical `primeTriviaConfig(sdk, config)` wrapping the reset/set-sdk/set-config trio, defaulting `config` to `{ games: [] }` so omitting it is inert
- [x] 4.2 Replace the three copy-pasted local helpers: `primeBridge` in `setWorkspaceConfig.test.ts` and `deleteGame.test.ts`, `primeConfig` in `core/dataLayer.test.ts`

## 5. Retire the hand-rolled fakes

- [x] 5.1 `catchUp.test.ts` — delete `makeHarness`'s ~40 lines of `vi.fn` rewrapping; assert directly on `sdk.dmOwner` / `sdk.runCronJobNow` / `sdk.missedRuns`
- [x] 5.2 `core/dataLayer.test.ts` — delete `makeMemorySdk`; `createFakeSdk` is now the memory sdk
- [x] 5.3 `lockQuestions.test.ts` and `unlockQuestions.test.ts` — delete both `fakeSdk` helpers and their `updateCalls: string[]` capture arrays; assert through the mock's call history
- [x] 5.4 `saveCheating.test.ts` and `upsertGame.test.ts` — delete both `makeFakeSdk` helpers
- [x] 5.5 Add a canonical fake for `RevealSlackDeps` in `testHelpers.ts`, replacing `fakeSlackDeps` in `computeAnswers.test.ts` and `cascadeParity.crossTool.test.ts`
- [x] 5.6 Add a canonical fake for `LockSlackDeps` in `testHelpers.ts`
- [x] 5.7 Confirm the full suite is green after each file's migration — commit per file

## 6. Bring the gating test home

- [x] 6.1 Add a unit-scope wiring test: boot `triviaPlugin(sdk)` against the fake; assert which tools land on `trivia` vs `trivia:management`, at what `minRole`
- [x] 6.2 Add the assertion the current test structurally cannot make: `TRIVIA_MANAGEMENT_DESCRIPTION`'s advertised tool list is **exhaustive and exact** against actual registrations — this is what catches the `unlock_questions` drift
- [x] 6.3 Add coverage for the seasons gate: with seasons off, `upsert_season` / `delete_season` are absent; with seasons on, present
- [x] 6.4 Reduce `integration.gating.test.ts` to the question only it can answer — that `resolveEffectiveRegistry` merges a plugin's `registerMcpServer` into the catalog (design Risks); drop the tool-placement assertions now covered at unit scope
- [x] 6.5 Confirm 6.2 fails against current `index.ts`, then passes once the description bug is fixed separately — do NOT fix the description in this change

## 7. Rescope the guard test

- [x] 7.1 Remove `t` / `actionId` from `SDK_MEMBER_STUB` — the compiler owns them now (design D2)
- [x] 7.2 Remove `dmOwner` / `readFile` / `writeFile` — mocking them is the sanctioned path
- [x] 7.3 Add detection for local factories returning object literals typed as a collaborator interface
- [x] 7.4 Add detection for capture-array recording (`const calls: string[] = []` + `.push` in place of a mock's call history)
- [x] 7.5 Confirm the rescoped guard catches every offender named in tasks 5.3 and 5.5 before those are fixed, and passes after
- [x] 7.6 Update the guard's header comment to state the rule it now enforces, and note that internal cross-calls bypass spies by design (design Risks)

## 8. Documentation and close-out

- [x] 8.1 Document the rule in `CLAUDE.md`'s Test Conventions: a fake may widen a member's type, never add one; test-only affordances live in `testHelpers`
- [x] 8.2 Document: construct fakes in `beforeEach`, never at module scope — this is what makes `restoreMocks: true` a non-issue (design Risks)
- [x] 8.3 Run `npx tsc --noEmit`, `npx oxlint src/plugins/trivia`, `npx oxfmt`, and the full `npm test`
- [x] 8.4 Confirm `createInMemoryDataLayer` and its ~64 consumers are untouched — the boundary with `refactor-trivia-data-layer`
- [x] 8.5 Resolve the `overrides` open question: keep for migration, or remove and update the guard's `insideFakeSdkOverrides` proximity check
