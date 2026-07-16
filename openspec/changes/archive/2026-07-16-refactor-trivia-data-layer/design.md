## Context

`createInMemoryDataLayer` is a ~130-line reimplementation of `TriviaDataLayer` used by 68 test files. The real `createSdkDataLayer` it stands in for is a thin JSON marshaller — `readFile → JSON.parse → zod gate → array op → stringify → writeFile` — carrying almost no domain logic. The fake therefore duplicates *collection semantics*, not business rules, and drifts from them in at least three documented places.

The suite splits roughly three ways today:
- ~31 files use the layer as a seed/sink and assert on the tool's return envelope; the fake's behavior is incidental.
- ~25 files seed-then-filter (`find_previous_questions`, `get_ideas`); they need reads to return what was seeded.
- ~8 files exercise handlers that load → update → load within one call; they need real read-after-write.

`domain/` — 23 files — needs no fake at all, because its logic is pure. That is the shape the rest is missing, and the long-term cure; it is out of scope here.

This design is the product of six spikes against the real types, run under the project's `tsc` and `vitest`. Every decision below is a recorded finding.

**Constraints:**
- Depends on `refactor-trivia-fake-sdk` landing first.
- `~/.claude/claude-dont` bans `as unknown`, `as never`, `Record<string, unknown>`, `) as X`.
- CLAUDE.md: unit tests mock outside dependencies; unit and integration tests live in separate files; `*.integration.test.ts` is the real-I/O escape hatch.
- `src/plugins/CLAUDE.md`: no imports outside the plugin folder except the SDK.

## Goals / Non-Goals

**Goals:**
- Delete the second implementation. This was the originating request: *"the goal is not to create a secondary implementation for tests."*
- Give the six integration files a real substrate, so they test what their suffix claims.
- Make every data-layer call observable without sacrificing coherent default behavior.
- Keep `createTriviaDataLayer` free of test-only members and free of `testHelpers`.

**Non-Goals:**
- Converting existing state-based assertions to interaction assertions. Availability, not imposition.
- Extracting handler decision logic into `domain/`. The real long-term fix, but opportunistic and separate.
- Changing production code, including the config bridge's module-global.

## Decisions

### D1: `vi.fn(impl)` / `vi.spyOn` dominate the fake-vs-mock choice

The framing that stalled this — a coherent fake versus scattered constant defaults — is a false dichotomy. A mock *with* an implementation is strictly a superset: same behavior, plus call recording, plus per-method stubbing.

This dissolves four objections at once: no made-up constants (`saveCheat` runs the real tally), no read-after-write problem (state backs the reads), no mockist brittleness imposed across 31 files, and no forced churn (behavior-identical, so existing tests pass unchanged).

### D2: If an implementation is being provided anyway, use the **real** one

Given D1, `spyOnAll(handWrittenInMemory())` and `spyOnAll(createSdkDataLayer(sdk))` have identical ergonomics and identical call sites. Only the second deletes the 130 lines and makes the season-bootstrap divergence *not exist* rather than be excused.

Verified end-to-end (9 tests, zero casts): state round-trips; spies observe; `forGame` memoizes; a single method stubs while the rest stay real; read-after-write works; the real season bootstrap fires and writes `games/<name>/seasons.json`; cheat tallies return `1, 2`; `recordJoin` is idempotent.

**Alternative rejected:** wrapping the hand-written fake. Keeps a second implementation for no ergonomic gain.

### D3: Build the returned object from `vi.spyOn`'s return values

`vi.spyOn(obj, key)` mutates `obj[key]` into a spy *and* returns it. Constructing the fake from those return values yields an object that is simultaneously assignable to `TriviaDataLayer` **and** exposes the mock API directly — with no cast:

```ts
const dataLayer = {
  loadCategories: vi.spyOn(real, "loadCategories"),
  // …
  forGame: (name) => memoized(spyScoped(real.forGame(name))),
};
const asReal: TriviaDataLayer = dataLayer;                                  // ✅
dataLayer.forGame("main").loadQuestions.mockResolvedValue([q]);             // ✅ no vi.mocked() wrapper
```

**Alternatives rejected:** returning `TriviaDataLayer` and wrapping every call site in `vi.mocked(...)` — noisy across 68 files. Casting the factory's return to a `Mocked<>` type — needs `) as X`, banned.

### D4: `forGame(name)` must memoize

The real implementation returns a fresh closure per call. Without memoization, `expect(data.forGame("main").saveQuestion).toHaveBeenCalled()` asserts against an object the code under test never touched — it **fails green-looking**, the worst failure mode available. Memoize by name; the production API then *is* the observation point, and no `scoped()` accessor is needed.

### D5: `createTriviaDataLayer(sdk)` takes the sdk and owns nothing

`files` is the sdk's storage, not the data layer's. With all state concentrated in `createFakeSdk`, this factory owns nothing and therefore returns `{ dataLayer }` with no `testHelpers` — the shape falls out rather than being designed.

It also mirrors production, where one sdk threads through `triviaPlugin(sdk)`, and it means a test needing both gets the *same* sdk rather than a second one buried in a helper's return.

### D6: Config priming is a sibling, not a second argument

`createSdkDataLayer` reads `loadTriviaConfig()` from a module-global that plugin init primes. Tests must prime it too — three lines, already exposed via `_resetTriviaConfigBridge` / `_setTriviaConfigSdkForTests` / `_setTriviaConfigForTests`, already used by four files.

It goes in `primeTriviaConfig(sdk, config)` (added by `refactor-trivia-fake-sdk`), not as a second argument to `createTriviaDataLayer` — keeping the factory's signature identical to production's is worth more than saving a line. The call site then reads like production's actual wiring.

### D7: Is running the real layer in a unit test legitimate?

The sharpest tension in this change. CLAUDE.md says *"A test file named for module/tool X asserts X's OWN behavior — it must not re-test a dependency's behavior through X."*

It is legitimate, on a distinction worth naming: **the dependency is never asserted, it only supplies plausible defaults.** Nothing in `settleQuestion.test.ts` claims anything about the data layer, and any assertion its behavior influences can be neutralized by stubbing that one method.

The seam makes this structural rather than aspirational: **spies sit at the boundary, and internal cross-calls bypass them.** `saveQuestion` calls `loadQuestions()` through a closure, so a spy sees 0 calls, not 1 (verified). A test *cannot* observe the dependency's internals even if someone tried — the rule's target becomes unwritable.

### D8: Test scope is chosen by substrate, not by helper name

The current contradiction is that all six `*.integration.test.ts` files run on a fake. After this change the axis is explicit:
- **Unit** — real layer as a coherent default; stub whatever the test's claim depends on; assert the tool.
- **Integration** — real layer, nothing stubbed, real flow end to end.

Same factory, same call site; the difference is whether the test stubs anything. That is a better boundary than two similarly-named helpers.

### D9: Enumerate all 18 methods; no generic `spyOnAll<T>`

A key-walking helper needs `as unknown`, `as never`, and `Record<string, unknown>` — all banned, and the ban is right here. Explicit enumeration (6 global + 12 scoped) costs ~18 lines, needs zero casts, and **fails loudly when `TriviaDataLayer` grows a method** — exactly when a hand-written fake would silently drift. The constraint improves the result.

### D10: Seed by programming the read, never by invoking an unrelated write

Because every method is independently stubbable (D1), a test seeds a read's result with `loadQuestions.mockResolvedValue([q])` rather than `await saveQuestion(q)`. Seeding through the write path couples the test to a collaborator it is not testing — a `find_previous_questions` test should not fail because `save_question` broke. This is spec Requirement 6; the migration tasks in sections 5–6 apply it mechanically.

## Risks / Trade-offs

- **Internal cross-calls are invisible to spies** → Accepted as the design (D7). Document it in the helper; it enforces the unit boundary rather than eroding it.

- **The config-bridge module-global is shared state across a file** → vitest isolates modules per test file, and `primeTriviaConfig` resets before each prime. Codify: call it in `beforeEach`, never at module scope.

- **68 files is a large diff** → Mitigated by D1: behavior is preserved, so migration is per-file and mechanical, and the suite stays green throughout. Sequence by value — the 6 integration files first (they fix a real contradiction), the ~8 read-after-write files next (they gain the most), the seed/sink majority last (they gain least and can stop early if the value isn't there).

- **A test forgets to prime config and gets `null`** → Same behavior as today's fake, which never bootstraps a season. Give `primeTriviaConfig` a sensible default (`{ games: [] }`) so the omission is inert rather than surprising.

- **Real layer is slower than the fake** (JSON serialize/parse per call vs array push) → Measured: 9 spike tests in 6ms. Not a concern at this suite's scale.

- **Value may not justify the tail** → Explicitly allowed to stop. The 6 integration files and the ~8 read-after-write files carry nearly all the value; the ~31 seed/sink files carry little. Treat the last group as optional, not as a consistency obligation.

## Migration Plan

1. Land `refactor-trivia-fake-sdk` first — this change needs its Map-backed store, working `users.data`, and `primeTriviaConfig`.
2. Add `createTriviaDataLayer(sdk)` beside `createInMemoryDataLayer`. Both coexist; nothing breaks.
3. Migrate the 6 `*.integration.test.ts` files. Highest value: they stop being contradictions. Verify each gains the real season bootstrap.
4. Migrate the ~8 read-after-write files; delete any `mockResolvedValueOnce` chains they were using to fake staleness.
5. Migrate the seed/sink and seed-then-filter files, converting write-path seeding to `loadX.mockResolvedValue(...)`.
6. Delete `createInMemoryDataLayer`, `InMemoryDataLayer`, and the four seams once the last consumer is gone.
7. Document the substrate-chooses-scope rule (D8) in CLAUDE.md's Test Conventions.

**Rollback:** each file is an independent commit against a green suite. Steps 3–5 can stop at any point with both helpers coexisting — an acceptable resting state, not a broken one.

## Open Questions

All three resolved during implementation (recorded on the corresponding tasks):

- **Map or tmpdir for the six integration files?** → **Map.** A tmpdir would require a real-fs `ClackSdk` fake that doesn't exist, and buys only `games/<name>/*.json` path-assembly coverage that the Map keys already exercise (task 3.1).
- **Do cheat-tally tests belong at unit scope?** → **Keep the real tally as the coherent default.** The tool tests assert the envelope (which surfaces `totalAttempts`), never the algorithm; the tally's own claim lives in `testHelpers.dataLayer.test.ts`. Stubbing `saveCheat` stays available per test (task 6.3).
- **Where does the ~31-file tail stop?** → **It doesn't.** The tail was cheap at migration time, and finishing it unlocked section 7 — deleting the second implementation, the change's headline goal (task 6.1).

## Implementation note

Migrating `computeAnswers.test.ts`'s display-name-refresh test exposed that `FakeSdk` typed `users`/`memory` as the bare production interfaces, hiding the mock API their members already carry at runtime. Fixed in the canonical fake per the open-closed doctrine: `testHelpers.fakeSdk.ts` now exports `FakeSdkUsers` / `FakeSdkMemory` widening the query members to `Mock<…>` (the `data` accessors stay plain generics, like production).
