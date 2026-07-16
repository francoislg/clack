## Context

`createFakeSdk` (`src/plugins/trivia/testHelpers.ts`) is a null object over `ClackSdk`. Every collaborator member is `() => {}` or an `async` returning a trivial constant; arguments are discarded. Two members carry real logic (`readFileOrSeed` delegates to `this.readFile`/`this.writeFile`; `t` formats interpolation), and one actively throws (`watchFile`).

The consequence is that **plugin wiring is unobservable**, which pushed work outward: `integration.gating.test.ts` boots the real SDK against a tmpdir to ask a unit-scope question; `catchUp.test.ts` rewraps members in `vi.fn` by hand; ~11 local collaborator fakes have accreted across the suite, three of them literal duplicates.

Every decision below was verified by spike against the real `src/plugins/sdk.ts` — typechecked with the project's `tsc` and exercised under `vitest`. Findings are recorded as decisions rather than intentions.

**Constraints:**

- `~/.claude/claude-dont` bans `as unknown`, `as never`, `Record<string, unknown>`, `) as X`, and `: any`/`: never` params.
- `vitest.config.ts` sets `restoreMocks: true`.
- `src/plugins/CLAUDE.md`: plugin code may not import outside the plugin folder except the SDK, leaf SDK utilities, third-party, and node built-ins.
- CLAUDE.md test conventions: fakes are open-closed; `sdk.t`/`sdk.actionId` have one faithful rendering and must never be overridden.

## Goals / Non-Goals

**Goals:**

- Make every `ClackSdk` collaborator observable, so wiring assertions become possible and `integration.gating.test.ts` can return to unit scope.
- Keep `FakeSdk` assignable to `ClackSdk` with zero added members.
- Make the "never override `t`/`actionId`" rule compiler-enforced rather than regex-enforced.
- Retire the hand-rolled local fakes and the duplicated bridge-priming helpers.
- Change no existing test's _assertions_ — `vi.fn(impl)` is a behavior-identical superset, so adoption is opt-in per test.

**Non-Goals:**

- `createInMemoryDataLayer` and its ~64 consumers (`refactor-trivia-data-layer`, which depends on this).
- Any production code change. `src/plugins/sdk.ts` is read-only here.
- Fixing `TRIVIA_MANAGEMENT_DESCRIPTION` — handled as a separate bug fix. This change adds the test that _catches_ it.
- Extracting tool-handler decision logic into `domain/` (a separate, opportunistic concern).

## Decisions

### D1: Intersect, don't map — `FakeSdk = ClackSdk & { …mocked keys }`

A replacing mapped type (`{ [K in keyof ClackSdk]: Mock<…> }`) **does not compile**:

```
TS2322: Type 'MockedExcept<ClackSdk, …>' is not assignable to type 'ClackSdk'.
  Types of property 'registerTool' are incompatible.
```

**`Mock<T>` erases generics.** It is defined over `Procedure = (...args: any[]) => any`, so wrapping `registerTool<T extends AnyZodRawShape>` instantiates `T` to its constraint; the resulting concrete signature cannot stand in for a generic one (contravariance on `tool`). `ClackSdkUsers.data<T>` fails identically.

An intersection assigns for free (it _contains_ `ClackSdk`) and rides the mock API on top — including on the generic members:

```ts
type FakeSdk = ClackSdk & { [K in MockedKeys]: Mock<Extract<ClackSdk[K], AnyFn>> };
```

Verified: `const asSdk: ClackSdk = fake` ✅; `fake.registerTool.mockImplementation(…)` ✅; `fake.t("k", { a: 1 })` still returns `string` ✅.

**Alternative rejected:** exclude generic members from mocking. That would leave `registerTool` unobservable — the exact member whose unobservability exiled the gating test.

### D2: Renderers stay plain functions, enforced by omission from `MockedKeys`

`t`, `actionId`, `viewCallbackId` are not collaborators — nobody asserts "`t` was called". Their faithful rendering _is_ the assertion: `t("k") → "k"` means asserting a block's text equals `"trivia.hint.label"` already proves it went through `t()`.

Leaving them out of `MockedKeys` makes `sdk.t.mockReturnValue("x")` a **compile error** (verified via `@ts-expect-error`). The CLAUDE.md rule becomes structural and unevadable.

### D3: A fake may widen a member's type; it may never add one

`dmOwner: Mock<…>` is widening — same surface, richer type. `userData`, `mcpServerFor`, `scoped()` would be _new members_, reproducing `InMemoryDataLayer`'s existing sin (`TriviaDataLayer & { saveUser, saveUsers, getUserData }`).

They are unnecessary. **`registerMcpServer(name)` memoizes by name**, so the handle a test fetches IS the handle the plugin registered tools on — the production API is the observation point.

`users.data(schema)` / `memory.data(schema)` deliberately do NOT memoize the accessor object, on two findings from implementation: production itself returns a fresh accessor per call (`createUsersSurface`, `sdkUsers.ts:44`), and a cast-free memoization is type-impossible — a cache holding `ClackSdkUserData<T>` for an unknown future `T` cannot be read back without a banned cast (the variance runs the wrong way in both directions). Instead every accessor shares ONE backing store per fake, so state written through any accessor is readable through the production API. Nothing is lost: the one production consumer captures its accessor once inside `createSdkDataLayer` (`dataLayer.ts:77`), so its `merge` calls are internal plumbing that the boundary doctrine says no test should assert anyway.

Anything the interface genuinely cannot express goes in `testHelpers`, never on the object.

### D4: `testHelpers` holds what the _other side of the boundary_ did — not back doors

Trivia never writes users in production; core populates the registry and `loadUsers()` reads `sdk.users.list()`. So a seeding affordance is not a back door into fake state — it models **another actor crossing the boundary**, which has no home on `ClackSdk` because it isn't the plugin's operation.

This is the discriminator: `testHelpers` containing "core did X" is correct; `testHelpers` containing "reach into my hidden state" means the state is in the wrong place.

### D5: The store lives on the sdk fake, and the sdk is passed in

`files` is the _sdk's_ storage. Concentrating all state in `createFakeSdk` means downstream fakes own nothing and therefore need no `testHelpers` of their own — this is what collapses ~11 helpers to 3, and it mirrors production, where one sdk threads through `triviaPlugin(sdk)`.

Two costs disappear as a result:

- `readFileOrSeed`'s `this`-binding hazard — with Map-backed defaults, its real delegation just works.
- `makeMemorySdk` in `dataLayer.test.ts` — `createFakeSdk` _is_ the memory sdk.

### D6: `users.data<T>` needs no cast

Initially assumed to require a banned `as unknown`. It does not. The SDK's `data<T>` is **unconstrained**, and a faithful fake writes cleanly against it using zod's own narrowing:

```ts
data: <T>(schema: z.ZodType<T>): ClackSdkUserData<T> => ({
  get: async (id) => {
    const raw = store.get(id);
    return raw === undefined ? null : schema.parse(raw);
  },
  merge: async (id, partial) => {
    store.set(id, { ...store.get(id), ...partial });
  },
});
```

`store: Map<string, object>`. Verified: cheat tallies return `1, 2` through the real logic; `recordJoin` is idempotent. A `<T extends object>` constraint **fails** (cannot accept the unconstrained `T`) — the generic must stay open.

### D7: Enumerate members explicitly; no generic `spyOnAll<T>`

A generic key-walking helper requires `as unknown`, `as never`, and `Record<string, unknown>` — all banned. Explicit enumeration needs **zero** casts, costs ~18 lines, and fails loudly when the interface grows a member — precisely when a fake would otherwise drift silently. The constraint improves the outcome.

### D8: The guard test's member list dissolves; its job narrows

`t`/`actionId` move to the compiler (D2). `dmOwner`/`readFile`/`writeFile` become the sanctioned path. What remains is the thing a type cannot catch and the current regex misses: **hand-rolled collaborator objects** — `fakeSlackDeps(): RevealSlackDeps` (×2), `fakeSdk(): { sdk: LockSlackDeps; updateCalls: string[] }` (×2). The `updateCalls` capture arrays also violate CLAUDE.md's "capture-style overrides should be `vi.fn()` instances" rule.

## Risks / Trade-offs

- **`restoreMocks: true` could reset `vi.fn(impl)` defaults between tests** → Non-issue in practice: every consumer constructs its fake in `beforeEach` or per-test, which makes restoration moot. Codify it — construct fakes in `beforeEach`, never at module scope — and the risk cannot re-emerge. Verified across 12 spike tests.

- **Internal cross-calls bypass the spy.** `saveQuestion` calls `loadQuestions()` through a closure, so a spy on the object sees 0 calls, not 1 → **Accepted as the design.** You observe what the _tool_ asked for, not the plumbing. It structurally enforces CLAUDE.md's "must not re-test a dependency's behavior through X" — the wrong test becomes unwritable. Document it in the helper so it doesn't surprise.

- **Intersection types produce noisy errors on mismatch** → Contained: the type lives in one file, and every consumer sees a plain `ClackSdk` unless it reaches for the mock API.

- **`integration.gating.test.ts` loses real-SDK coverage** when it moves to unit scope → The real-SDK path is genuinely valuable, but for a _different_ question (does `resolveEffectiveRegistry` merge a plugin's `registerMcpServer` into the catalog?). Split it: keep an integration test for the registry-merge pipeline; move the "which tools on which server" assertions to unit scope where exhaustiveness is cheap.

- **Scope creep into `refactor-trivia-data-layer`** → Hard boundary: `createInMemoryDataLayer` is not touched here. It keeps working unchanged; this change only makes the sdk beneath it observable.

## Migration Plan

Additive and non-breaking by construction — `vi.fn(impl)` preserves today's behavior, so no consumer _must_ change.

One placement note from implementation: the fake sdk lives in a NEW sibling module, `testHelpers.fakeSdk.ts` (types, `createFakeSdk`, `primeTriviaConfig`, the SlackDeps fakes), rather than growing `testHelpers.ts` past the repo's 500-line file cap. `testHelpers.ts` keeps the fixtures and `createInMemoryDataLayer`; there is no re-export shim — consumers import each from its own module.

1. Rewrite `createFakeSdk` → `{ sdk, testHelpers }`, folding in `fakeSdkUsers`/`fakeSdkMemory`. Keep the existing `overrides` parameter working during migration.
2. Migrate the hand-rollers one file at a time (`catchUp`, `dataLayer`, `lock*`, `saveCheating`, `upsertGame`), deleting each local helper as its canonical replacement lands.
3. Move `integration.gating.test.ts`'s tool-placement assertions to unit scope; add the exhaustiveness assertion.
4. Rescope the guard test.
5. Remove `fakeSdkUsers`/`fakeSdkMemory` once the last consumer is gone.

**Rollback:** each step is an independent commit against a green suite; revert individually.

## Open Questions — resolved during implementation

- **Does the `overrides` parameter survive?** KEPT, typed narrowly as `FakeSdkOverrides` (the mocked collaborator keys plus `capabilities`). The narrowing removes the abuse surface the question worried about: renderers, `users`, `memory`, and `mcpServer` are structurally un-overridable, and an override stays observable because the member mock wraps it. The rescoped guard needs no `createFakeSdk(` proximity check — its sanction window keys off the canonical factories generally.
- **Should `RevealSlackDeps` / `LockSlackDeps` get canonical fakes in this change or the next?** This change (`createFakeRevealSlackDeps` / `createFakeLockSlackDeps` in `testHelpers.fakeSdk.ts`), as leaned — the guard rescope landed here and immediately caught two hand-rolled `RevealSlackDeps` literals the file-by-file migration had missed, which settled the question.
