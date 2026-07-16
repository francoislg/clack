## Why

`createInMemoryDataLayer` is a **second implementation of `TriviaDataLayer`** — ~130 lines of array and Map logic, consumed by 68 test files. Its own docstring admits it diverges from production:

> *"No lazy season-bootstrap (the production behavior depends on `getConfig()`, which tests typically don't load)"*

That divergence exists to dodge a module-global, and it is not the only one — `updateAnswer` warns in production and is silent in the fake; `removeCheat` skips the write on a zero-removal in production and always reassigns in the fake.

The sharper problem is that **it serves neither test scope correctly**:

- **Too real for a unit test.** It has behavior, so tests accidentally depend on it, and seeding is laundered through the write path — `await data.forGame("main").saveQuestion(q)` exists only to make `loadQuestions` return `q`, coupling a `find_previous_questions` test to `save_question`'s implementation.
- **Too fake for an integration test.** All six `*.integration.test.ts` files use it. An integration test on a fake substrate pays integration's cost and buys none of its payoff — it proves *"the reveal flow works against fake storage,"* which is not a claim anyone needs.

Meanwhile `src/plugins/trivia/domain/` is **23 test files with zero fakes**, because its logic is pure. The fake is load-bearing precisely where decision logic is still fused to persistence.

A spike against the real types settled the approach: the real `createSdkDataLayer` is a thin JSON marshaller over `sdk.readFile`/`sdk.writeFile`, so it can be driven directly with every method spied — **giving coherent real behavior and full observability at once, with no second implementation.** Verified end-to-end: 9 passing tests, zero casts, clean `tsc` and `oxlint`.

## What Changes

- **`createInMemoryDataLayer` is removed**, along with its four test-only seams (`saveUser`, `saveUsers`, `getUserData`, and the `resolveIdentity` constructor option) and the `InMemoryDataLayer` type.
- **`createTriviaDataLayer(sdk)` replaces it.** It runs the **real** `createSdkDataLayer(sdk)` with every method wrapped by `vi.spyOn`, so the default behavior is production's and any method can still be stubbed per test. It mirrors production's signature exactly and owns no state, so it returns `{ dataLayer }` with no `testHelpers`.
- **State lives only in the sdk fake.** `createFakeSdk` (from `refactor-trivia-fake-sdk`) already owns `files`, users, and identities — so nothing downstream needs a back door. This is what collapses the helper count.
- **Seeding stops going through the write path.** `data.forGame("main").loadQuestions.mockResolvedValue([q1, q2])` replaces N `saveQuestion` calls, and no longer depends on `save_question` working to test `find_previous_questions`.
- **The six `*.integration.test.ts` files get a real substrate**, making them actually integration tests. They gain the production behaviors the fake lacks — notably the season bootstrap.
- **Read-after-write works.** The eight handlers that load-then-update-then-load (`computeAnswers`, `freeform`, `settleQuestion`, `postQuestions`, and four more) need no `mockResolvedValueOnce` chains, because real state backs the reads.
- **Cheat tallies run real logic**, not a constant — verified returning `1, 2` across two `saveCheat` calls through `sdk.users.data`.

**Not a wholesale mock migration.** Existing state-based assertions keep working unchanged; interaction assertions become available per test rather than imposed. This is deliberate — mockist tests break on refactors state-based tests survive, and a batch rename of `saveQuestion` should not fail 31 files for zero behavior change.

## Capabilities

### New Capabilities

<!-- None. `trivia-test-fakes` is introduced by refactor-trivia-fake-sdk; this change extends it. -->

### Modified Capabilities

- `trivia-test-fakes`: Adds the requirements governing a faked stateful collaborator — that the canonical data layer fake runs the real implementation rather than a reimplementation, that every method is both observable and individually stubbable, and that test scope is chosen by substrate rather than by helper name.

## Impact

- **Depends on `refactor-trivia-fake-sdk`** and cannot start before it. It needs the Map-backed `readFile`/`writeFile`, the working `users.data` store, `testHelpers.saveUser`, and `primeTriviaConfig`.
- **`src/plugins/trivia/testHelpers.ts`** — `createInMemoryDataLayer` and `InMemoryDataLayer` removed; `createTriviaDataLayer(sdk)` added with all 18 methods enumerated explicitly (a generic `spyOnAll<T>` requires casts banned by `claude-dont`).
- **68 test files** migrate from `createInMemoryDataLayer()` to `createFakeSdk()` + `primeTriviaConfig(sdk, config)` + `createTriviaDataLayer(sdk)`. Most assertions are untouched; the seeding lines change.
- **6 `*.integration.test.ts` files** move onto the real substrate — the change's highest-value target, and the only one fixing a scope contradiction rather than an ergonomic one.
- **No production code changes.** `createSdkDataLayer` is consumed as-is; `_setTriviaConfigForTests` / `_setTriviaConfigSdkForTests` / `_resetTriviaConfigBridge` already exist and are already used by four files.
- **Open tension:** running the real data layer inside a unit test brushes against CLAUDE.md's *"collaborators are mocked or stubbed."* Resolved in design — the dependency provides plausible defaults, it is never asserted, and any method it influences can be stubbed. The rule's real target (re-testing a dependency *through* X) is structurally prevented, because spies at the boundary cannot see internal cross-calls.
