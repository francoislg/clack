# Add Cron Catch-Up On Boot

## Why

The cron scheduler is a 60-second tick that only matches slots occurring in the last 60 seconds — any slot that passes while Clack is down (including routine deploys) is silently lost. A deploy landing exactly on a trivia question slot skips the whole day's game: no question, no lock, no reveal, and nobody is told. The building blocks for recovery already exist (persisted `lastRunAt`, fire-now execution, self-guarding trivia prompts) but nothing invokes them after downtime.

## What Changes

- **Delayed-boot plugin hook (core)**: after boot + a configurable delay (`config.cron.catchUp.delayMinutes`, default 3), core invokes each plugin's registered `sdk.onDelayedBoot(handler)` callback — on **every** boot, sequentially per plugin. Plugins decide in code what (if anything) to do; core carries no catch-up policy.
- **New SDK query `sdk.missedRuns(specKey)`**: returns `{ lastExpectedRuns: Date[] }` — the cron occurrences of the plugin's own job that should have fired but didn't (computed from the job's cron expression vs persisted `lastRunAt`, fallback `createdAt`), over a bounded lookback. Owner-scoped: a plugin can only query its own reconciled jobs.
- **New SDK helper `sdk.runCronJobNow(specKey)`**: fires one of the plugin's own jobs immediately as a plain run — **no `asOf` replay semantics**. Routes through the existing `executeJob` path so `skipDates`, the concurrency guard, and `lastRunAt` double-fire protection all apply; the tick will not re-fire the slot afterwards.
- **Trivia catch-up handler**: per game, sequentially and in this order — missed `:lock` → fire now; missed `:reveal` → fire now (the reveal's empty-batch branch already silently skips when no question was posted); missed `:question` → fire now ONLY IF the next regular question fire is AFTER the game's next lock-or-reveal occurrence AND now + 2h ≤ that occurrence; otherwise skip and DM the deployment owner (`sdk.dmOwner`) that the quiz day was lost. Missed `:prep` is never fired (the question prompt falls back to inline generation). Only ONE catch-up question fire ever happens regardless of how many slots were missed — multi-day gaps are skipped, not backfilled.

Out of scope (deliberate): catch-up for user-created jobs (no notification, no replay — status quo), `asOf` replay-date semantics (catch-up fires are plain fire-nows), and any declarative per-job catch-up policy attribute (judgement lives in plugin code).

## Capabilities

### New Capabilities

- `cron-catch-up`: the core delayed-boot hook dispatch (`onDelayedBoot`), the `missedRuns` / `runCronJobNow` SDK surface with owner scoping, and the `cron.catchUp.delayMinutes` config knob.
- `trivia-catch-up`: the trivia plugin's delayed-boot handler — lock → reveal → question ordering, the two question-catch-up guards, the owner DM on a lost quiz, prep exclusion, one-fire-max semantics.

### Modified Capabilities

<!-- none — the tick scheduler (`cron-messages`), reconcile API (`plugin-cron-reconciliation`), and existing SDK members (`clack-plugins`) are consumed as-is; precedent: plugin-facing cron SDK members live in their own capability (cf. plugin-cron-reconciliation) -->

## Impact

- `src/plugins/sdk.ts` — three new SDK members (`onDelayedBoot`, `missedRuns`, `runCronJobNow`), owner-scoped like `reconcileCronJobs`.
- `src/cronScheduler.ts` — exposes the fire-now entry used by `runCronJobNow` (reusing `executeJob` without `asOf`); the delayed dispatch is scheduled from the boot path after `startCronScheduler`.
- `src/index.ts` — boot sequence wires the delayed hook dispatch (after plugin load + reconcile).
- `src/config.ts` / config schemas — new fail-fast `cron.catchUp.delayMinutes` knob (zod).
- `src/cronJobs.ts` — read-only consumer (`lastRunAt`, `createdAt`, `enabled`, `plugin` + `specKey` lookup); no persisted-schema change.
- `src/plugins/trivia/` — new catch-up module registered from plugin init; reads game crons from trivia config; owner DM string via `sdk.t()` (en + fr dictionary entries).
- Docs: CLAUDE.md cron/plugin sections; `docs/`-level note not required (plugin-internal behavior).
