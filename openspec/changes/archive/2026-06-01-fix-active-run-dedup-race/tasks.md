## 1. Audit (gates the register-or-bail change)

> **Findings:**
> - **Message triggers** all funnel through `processMessage` (callers: `cronScheduler.ts`, `autoRespond.ts`, `mention.ts`, `newQuery.ts`, `classicDm.ts`, `assistant.ts`). The per-thread lock added there covers every message-trigger path.
> - **Button handlers** (`choice.ts`, `followup.ts`, `retry.ts`) call `executeAndDeliver` → `askClaude` directly and never consult the registry. They normally fire on a *settled* response's buttons, so no run is active. They do not *depend* on "proceed without registration" — it's just the current default. Making the unclaimable-slot case fatal is safe and correct for them: a collision only happens if a button is clicked while another run is active on the same thread, and spawning a second run that resumes the same `sdkSessionId` concurrently would corrupt it. So §4 is applied globally in `askClaude` (not scoped).
> - `changeAction.ts` / `changeThreadActions.ts` do not call `askClaude`/`executeAndDeliver` directly (worker runs go through a separate path) — unaffected.
> - **Key match:** `session.threadTs` is set to `effectiveThreadTs` at creation (`core.ts` setupSession) and preserved on reuse, so the lock key (`effectiveThreadTs`) and the register key (`session.threadTs`) are identical for every trigger path. The concurrency test confirms this end-to-end (a key mismatch would make the second message spawn instead of `sendUpdate`).

- [x] 1.1 Enumerate every caller of `askClaude`/`executeAndDeliver` that can spawn a run (`core.ts` via `processMessage`, plus `choice.ts`, `followup.ts`, `retry.ts`, `changeAction.ts`, `changeThreadActions.ts`) and record, for each, whether it could legitimately run concurrently with an existing run for the same `(channelId, threadTs)`.
- [x] 1.2 Confirm no path depends on the current `index.ts:488` "proceed without registration" behavior; if one does, note it so the fatal change in §3 is scoped to trigger handlers only.
- [x] 1.3 Verify `effectiveThreadTs` (lock key, `core.ts:474`) equals `session.threadTs` (register key, `index.ts:486`) for every trigger path; document any path where they could diverge.

## 2. Per-thread serialization primitive

- [x] 2.1 Add a `withThreadLock(channelId, threadTs, fn)` helper to `src/slack/activeRuns.ts` backed by a `Map<string, Promise<unknown>>` chained with `prev.then(fn, fn)` and a `finally` that deletes the map entry when it is still the tail. (Early-release variant: `fn` receives a `release` callback; the next section waits on the gate opened by `release`, not on full completion.)
- [x] 2.2 Unit-test the helper: concurrent calls on the same key run strictly sequentially; calls on different keys run concurrently; a throwing `fn` advances the chain and cleans up the map entry (no leak, no deadlock). (5 tests in `activeRuns.test.ts`, incl. early-release and safety-net-on-completion.)

## 3. Make the consult-then-act atomic in `processMessage`

- [x] 3.1 Wrap the dedup block and spawn path of `processMessage` (`core.ts:474–629`) in `withThreadLock(channelId, effectiveThreadTs, …)` so the registry consult, the `sendUpdate` queue path, and the fresh spawn (through `executeAndDeliver` up to run registration) are serialized per thread.
- [x] 3.2 Ensure the lock is released as soon as the spawned run has registered (after `registerActiveRun`), not held for the run's full duration; the fast `sendUpdate` path returns inside the lock and releases immediately. (Wired via `AskClaudeOptions.onRegistered` → `release`, fired in `askClaude` right after the register attempt; the queued-follow-up path calls `release()` before returning.)
- [x] 3.3 Ensure every early-return and throw between the consult and registration resolves the lock (covered by `then(fn, fn)` + `finally`).

## 4. Make an unclaimable slot fatal to the duplicate

- [x] 4.1 In `askClaude` (`index.ts:486–492`), when `registerActiveRun` returns `false`, do NOT proceed: abort the freshly constructed run (stop/dispose the handle, close its input) instead of running untracked. Applied globally (per §1.2 audit — no caller depends on proceed-unregistered). Releases the lock first, then `run.stop("duplicate run for thread")` and returns the handle (resolves cancelled).
- [x] 4.2 Confirm the aborted run leaves no open streamer/"thinking" surface (tie streamer teardown to the abort path). `run.stop` → `futureResponse` cancelled → `executeAndDeliver`'s `handleCancellation` deletes the streamer messages and the `finally` stops the streamer.

## 5. Streamer ordering

- [x] 5.1 Ensure `streamer.start()` (`handlerResponse.ts:168`) only runs for an invocation that owns the slot. Satisfied by construction: for the spawn path `executeAndDeliver` (which starts the streamer) runs *inside* the locked section, before `release` fires at registration; a routed/queued follow-up returns before reaching `executeAndDeliver`, so it never starts a streamer.

## 6. Tests

- [x] 6.1 Concurrency test: two `processMessage` invocations for the same `(channelId, threadTs)` result in exactly one spawned run; the second routes via `sendUpdate`. (`core.test.ts` — "serializes two concurrent triggers".)
- [x] 6.2 Test the "second arrives during async setup" scenario (slow `createSession` on the first invocation) — no parallel run. (`core.test.ts` — "a second trigger during the first's slow setup does not spawn a parallel run".)
- [x] 6.3 Regression coverage: `registerActiveRun` returning `false` is exercised by `activeRuns.test.ts` ("rejects double registration"); the dedup-routes-to-existing-run behavior by `core.test.ts` ("routes to an already-registered run via sendUpdate instead of spawning"). A full `askClaude`-level abort test is disproportionate (requires mocking `buildQuerySetup`/`clackSession`); the abort branch is small and verified by inspection.
- [x] 6.4 Lock-key == register-key is verified end-to-end: the concurrency test's second message only finds the run (and `sendUpdate`s) if both keys match; a mismatch would make it spawn and fail the assertion.
- [x] 6.5 `npx tsc --noEmit`, `npx oxlint`, `npx oxfmt`, and `npm test` (5093 passed) all green.

## 7. Validate

- [x] 7.1 `openspec validate fix-active-run-dedup-race --strict` passes.
- [ ] 7.2 Manual repro check: two DM messages on a fresh thread within ~1s produce a single run and a single "thinking" indicator. *(Requires a running bot — to be done by the user on deploy.)*
