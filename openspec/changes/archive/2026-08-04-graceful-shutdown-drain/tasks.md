## 1. Shutdown module (quiesce state + drain orchestration)

- [x] 1.1 Create `src/shutdown.ts` with module-level quiescing state: `isQuiescing()`, `beginQuiesce()`, and an "already draining" latch
- [x] 1.2 Add a grace-budget resolver (env/config, default 300s) reusing the `DRAIN_MAX_WAIT` convention
- [x] 1.3 Implement `drainAndExit(deps)`: begin quiesce → loop awaiting in-flight handles against the live `busy` union up to the budget → on drain, run teardown and `exit(0)`; on budget elapse, `stop()` stragglers + log the cancelled set, then teardown and exit
- [x] 1.4 Inject in-flight-handle enumeration + teardown callbacks as a `deps` parameter to `drainAndExit()` (interface roughly `{ queryHandles: () => ClaudeRunHandle[]; workerHandles: () => ClaudeRunHandle[]; isBusy: () => boolean; teardown: () => Promise<void>; exit: (code: number) => void }`) so the orchestration has no direct import of `activeRuns`/`activeState`/`lifecycle` and is unit-testable
- [x] 1.5 Unit tests: idle → immediate exit; drains then exits when the last handle settles before budget; budget elapse stops stragglers and exits; second signal forces exit; repeated signals do not stack drains

## 2. Enumerate & await in-flight runs

- [x] 2.1 Add a handle-enumeration accessor to `src/slack/activeRuns.ts` returning the registered `ClaudeRunHandle[]` (the existing `snapshot()` returns `ActiveRunInfo` without the handle, so a new accessor is required); the drain loop uses it to `await` each `futureResponse` and to call `stop()`
- [x] 2.2 Add an accessor to `src/changes/activeState.ts` that enumerates the executing worker/tester run handles (e.g. `snapshotExecutingHandles()` returning handles with a callable `stop()`), wiring cancellation through the existing `worker-cancellation` path rather than a second cancel mechanism
- [x] 2.3 Ensure the drain's `busy` derivation reuses `activeRuns.snapshot()` + `snapshotRunningChanges()` so drain and `/status` agree by construction

## 3. Quiesce gates at the three choke points

- [x] 3.1 `processMessage` (`src/slack/handlers/core.ts`): early-return when `isQuiescing()` before any run registration; for interactive triggers post an ephemeral localized "restarting, back shortly" notice; for cron-origin query runs, skip silently
- [x] 3.2 Add the `t()` strings for the restarting notice to `src/i18n/strings/en.ts` and `fr.ts` (parity: FR value must differ from EN; if legitimately identical, add an allowlist entry per the parity test)
- [x] 3.3 `startChangeWorkflow` + `handleFollowUp` (`src/changes/workflow.ts`): early-return a rejected `ChangeResult` when `isQuiescing()` as the FIRST statement — before `setActiveChange` registers the change — so no worker/tester run starts and nothing is added to the changes active-state (every `executeChange` caller routes through these two entry points); the staged change remains staged
- [x] 3.4 cron `executeJob` (`src/cronScheduler.ts`): skip the fire when `isQuiescing()` so cron catch-up recovers it on the next boot
- [x] 3.5 Tests for each gate: quiescing refuses a new run and registers nothing; non-quiescing path is unchanged

## 4. Status endpoint `state` field

- [x] 4.1 Add `state: "running" | "draining"` to `StatusPayload` and `buildStatus` in `src/statusServer.ts`, sourced from `isQuiescing()`
- [x] 4.2 Update the status-handler unit tests to assert `state == "running"` normally and `state == "draining"` while quiescing; assert `busy`/`activeRuns`/`workers` semantics are unchanged

## 5. Wire the signal handler

- [x] 5.1 Replace the immediate-teardown `shutdown()` in `src/index.ts` with `drainAndExit(...)`, passing the real enumeration + teardown deps (`stopAll`, `statusServer.close`, `stopSlackApp`)
- [x] 5.2 Register SIGTERM and SIGINT to route through `drainAndExit`; a second signal forces `exit(1)`
- [x] 5.3 Ensure fatal boot errors (`main().catch`, boot-migration/config `process.exit(1)`) exit immediately WITHOUT routing through `drainAndExit()` — drain is signal-driven only; add a brief comment at the signal-registration site stating this invariant

## 6. Deploy script & skill (ship AFTER the image understands SIGTERM-drain)

- [x] 6.1 `scripts/gce-update-image.sh`: remove the Phase 1.5 external `/status` poll loop; change the swap's `docker stop clack` to `docker stop -t <budget>` with `<budget>` ≥ the process grace budget
- [x] 6.2 Update the `/deploy` skill Monitor filter and phase-acknowledgement guidance to match the process-side drain markers instead of the old external-poll markers
- [ ] 6.3 Manual/staging verification (deferred — requires a live deploy): deploy while a query run is in flight and confirm the run finishes before the swap; deploy while a worker run exceeds the budget and confirm it is cancelled and the swap proceeds

## 7. Validation

- [x] 7.1 `npx tsc --noEmit`, `npx oxlint`, `npx oxfmt --check` on changed files
- [x] 7.2 `npm test` green (new shutdown/gate/status tests included)
- [x] 7.3 `openspec validate graceful-shutdown-drain --strict`
