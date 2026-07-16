## Why

`createFakeSdk` is a **null object**: nearly every `ClackSdk` member is a no-op returning a trivial value, and arguments are discarded. That makes plugin wiring — which tools registered, at what role, on which server, behind which config gate — structurally unobservable, and the suite has been paying for it in three ways:

- **`integration.gating.test.ts` was exiled.** To answer "did trivia register its management tools on the on-demand server?", it boots the _real_ `createClackSdk`, writes a tmpdir config, mutates global plugin state, and runs the real `buildClackTools` — because `registerMcpServer: () => ({ registerTool: () => {} })` throws its arguments away. That is a unit-scope question paying integration-scope cost.
- **`catchUp.test.ts` hand-rolls the fix.** It rewraps four members in `vi.fn` _outside_ the factory and carries them back through a bespoke handle, ~40 lines of ceremony that exist only because the factory hands back bare functions.
- **~11 local collaborator fakes have grown in test files** — `makeMemorySdk`, `makeFakeSdk` (×2), `fakeSdk` with `updateCalls: string[]` capture arrays (×2), `fakeSlackDeps` (×2), `primeBridge`/`primeConfig` (×3, literal copy-paste). `testHelpers.guard.test.ts` exists to prevent exactly this and its regex catches none of them.

The unobservability also **hides live drift**. A spike that booted the real plugin against a fake sdk immediately found that `TRIVIA_MANAGEMENT_DESCRIPTION` advertises `upsert_season`/`delete_season` unconditionally (they are seasons-gated) and omits `unlock_questions` entirely (it is registered). `integration.gating.test.ts` has zero occurrences of `unlock_questions`. That bug is being fixed separately; this change is what makes its class of bug testable.

## What Changes

- **`createFakeSdk` returns `{ sdk, testHelpers }`.** All test-only state lives in one place; nothing is bolted onto the `ClackSdk` type.
- **Collaborator members become `vi.fn(defaultImpl)`** — a strict superset of today's behavior (same defaults, plus call recording), so existing tests keep passing while gaining interaction assertions.
- **`t` / `actionId` / `viewCallbackId` stay plain functions.** They have exactly one faithful rendering. Typed via intersection rather than a replacing mapped type, `sdk.t.mockReturnValue(...)` becomes a **compile error** — the "never overridden" rule moves from regex to the type system.
- **`readFile` / `writeFile` are backed by an in-memory store by default.** This retires `makeMemorySdk` and makes `readFileOrSeed`'s real delegation work rather than needing a special case.
- **`watchFile` no-ops instead of throwing.** Its current `throw new Error("watchFile not stubbed…")` is what blocks the plugin from booting against the fake at all.
- **`fakeSdkUsers` / `fakeSdkMemory` are folded into `createFakeSdk` and removed.** One direct consumer today. `users.data(schema)` gains a working store shared by every accessor (fresh accessor per call, exactly like production), so state written by the code under test is readable through the production API.
- **A canonical `primeTriviaConfig(sdk, config)` replaces the three copy-pasted bridge-priming helpers** (`primeBridge` ×2, `primeConfig`), wrapping the reset/set-sdk/set-config trio with a `{ games: [] }` default so omitting config is inert. `refactor-trivia-data-layer` depends on it.
- **The type never grows a member.** Widening a member's type (`dmOwner: Mock<…>`) is permitted; adding one is not. `FakeSdk` remains assignable to `ClackSdk`.
- **`testHelpers.guard.test.ts` is repurposed.** Its member list (`t|actionId|dmOwner|readFile|writeFile`) fully dissolves — the first two are enforced by the compiler, the rest are now the sanctioned path. Its new job is the thing it cannot do structurally and currently misses: no hand-rolled collaborator objects.

Not in scope: `createInMemoryDataLayer` and the ~64 files that consume it. That is `refactor-trivia-data-layer`, which depends on this change.

## Capabilities

### New Capabilities

- `trivia-test-fakes`: The contract every canonical test fake in the trivia plugin obeys — what a fake may and may not expose, which members are observable, which are structurally unmockable, and where test-only affordances live.

### Modified Capabilities

<!-- None. This change alters no production behavior; it changes test infrastructure and the fake's contract only. -->

## Impact

- **`src/plugins/trivia/testHelpers.ts`** — `createFakeSdk` rewritten; `fakeSdkUsers` / `fakeSdkMemory` removed; `InMemoryDataLayer` untouched (next change).
- **`src/plugins/trivia/testHelpers.guard.test.ts`** — rescoped to hand-rolled collaborator objects.
- **~17 files** consuming `createFakeSdk`. Most need no edit (`vi.fn(impl)` is behavior-identical); the ones that hand-roll are simplified: `catchUp.test.ts` (drops `makeHarness`), `core/dataLayer.test.ts` (drops `makeMemorySdk`, `primeConfig`), `lockQuestions`/`unlockQuestions` (drop `fakeSdk` + `updateCalls` arrays), `saveCheating`/`upsertGame` (drop `makeFakeSdk`).
- **`src/plugins/trivia/integration.gating.test.ts`** — becomes a unit test; drops tmpdir, `setLoadedPlugins`, and the real-SDK boot. Gains an exhaustiveness assertion (advertised description ≡ actual registrations) that would have caught the `unlock_questions` drift.
- **No production code changes.** `src/plugins/sdk.ts` is read-only here — the design was verified against its real types, including the unconstrained `data<T>` generic, with no casts required.
- **Constraint:** `~/.claude/claude-dont` bans `as unknown`, `as never`, `Record<string, unknown>`, and `) as X`. The design was spiked under these rules and needs none of them; a generic `spyOnAll<T>` helper would, so members are enumerated explicitly.
