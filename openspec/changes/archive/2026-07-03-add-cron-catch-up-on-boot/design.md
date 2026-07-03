# Design — add-cron-catch-up-on-boot

## Context

The cron scheduler (`src/cronScheduler.ts`) ticks every 60s and matches a job when the current time falls within a 60-second window after the job's most recent cron slot. Slots that pass while the process is down are never seen. Persisted state already supports detection: every fire writes `lastRunAt` (via `markJobStarted` *before* execution), and every job carries `createdAt`, `cronExpression`, and `timezone`. Execution machinery also exists: `executeJob(job, client)` handles the `skipDates` gate, the `runningJobs` concurrency guard, `markJobStarted` double-fire protection, run-history recording, and one-shot cleanup.

Boot order today: plugins load and reconcile their cron jobs (index.ts Step 1.8) → lifecycle starts → `startCronScheduler(client)` (`src/lifecycle.ts:154`). The plugin SDK (`src/plugins/sdk.ts`) is owner-scoped per plugin and already exposes `reconcileCronJobs(ownerKey, specs)`, `dmOwner(...)`, and `getSlackClient()`; `findByPluginOwner(ownerKey)` (`src/cronJobs.ts`) returns a plugin's own managed jobs.

Exploration settled the shape with the user: **hook-based, not declarative** — core reports facts and provides a fire-now lever; all catch-up judgement lives in plugin code. **No `asOf` replay semantics** — catch-up fires are plain fire-nows. **Trivia only** for v1; user-created jobs get nothing.

## Goals / Non-Goals

**Goals:**

- Detect missed cron fires after downtime (deploys included) with zero new persisted state.
- Give plugins a general delayed-boot lifecycle hook plus owner-scoped `missedRuns` / `runCronJobNow` primitives.
- Trivia recovers a lost round automatically when recovery is meaningful (lock → reveal → question order), and tells the owner when a quiz day is unrecoverable.
- Configurable settle delay (`cron.catchUp.delayMinutes`, default 3).

**Non-Goals:**

- No catch-up or notification for user-created jobs (`createdBy != null`).
- No `asOf` replay-date semantics anywhere in this change (the existing `run_scheduled_message_now` manual path is untouched).
- No declarative per-job catch-up policy attribute on `CronJob`/`CronJobSpec`.
- No backfill of multiple missed occurrences — trivia fires at most ONE catch-up question regardless of gap length.
- No catch-up handlers for other plugins (casual-talk, idler) in this change.

## Decisions

### D1 — Hook-based judgement, core stays policy-free

Core computes *facts* (which slots were missed) and exposes a *lever* (fire now). Whether firing is appropriate depends on plugin state (was the question actually posted? is there time to answer?) — inexpressible as a static per-job attribute. Alternative considered: declarative `catchUp: { mode, windowMinutes }` on `CronJobSpec`; rejected because the trivia reveal decision is inherently stateful and cross-job.

### D2 — `sdk.onDelayedBoot(handler)` fires on EVERY boot

Handlers are registered during plugin init and dispatched once per boot, `delayMinutes` after the cron scheduler starts, sequentially in registration order, each awaited, errors caught-and-logged per handler (one plugin's failure must not starve another's). Firing unconditionally (rather than only-when-missed) makes this a general-purpose "boot has settled" lifecycle hook; emptiness is the common case and cheap to check. The dispatch timer lives beside the scheduler lifecycle (started from the same path as `startCronScheduler`, cleared by the stop path) so soft restarts re-arm it and shutdown cancels it.

### D3 — `sdk.missedRuns(specKey)` returns `{ lastExpectedRuns: Date[] }`

Computation per job: iterate cron occurrences (in `job.timezone`, canonical slots — jitter deliberately ignored) from `max(lastRunAt ?? createdAt, now − LOOKBACK_CAP)` to now, excluding any occurrence ≤ `lastRunAt`, capped in count. `LOOKBACK_CAP` = 14 days, count cap = 100 — bounded work even for never-run jobs. Owner-scoped: the specKey resolves within `findByPluginOwner(ownerKey)` only; unknown specKey → error. Disabled jobs return an empty list (an intentionally-off job has no "missed" fires). Trivia only checks non-emptiness, but the dates make the owner DM concrete ("quizzes on Tue + Wed were lost").

### D4 — `sdk.runCronJobNow(specKey)` routes through `executeJob` WITHOUT `asOf`

Plain fire-now: `executeJob` gives the `skipDates` gate (evaluated against today — correct for fire-now semantics), the `runningJobs` guard, `markJobStarted` (so the tick cannot double-fire the slot), run-history recording, and error notification. Alternatives rejected: `runJobNow` (skips `markJobStarted` — unsafe against the tick) and `asOf` replay (user decision: a late quiz is just a normal fire, late; REPLAY CONTEXT date-pretending is wrong for interactive trivia). Requires the scheduler's Slack client — dispatch after `startCronScheduler` guarantees availability; a null client is an error result, not a crash.

### D5 — Trivia ordering: lock → reveal → question, self-guarding fires

Per game, sequentially awaited (reveal must observe locked state; a new question must not land mid-reveal); games processed one at a time to avoid a Claude-session stampede at boot+3min.

- Missed `:lock` → fire now, unconditionally (locking is harmless when nothing is open).
- Missed `:reveal` → fire now, unconditionally (the reveal prompt's existing empty-batch branch silently skips when no question was posted — safety by construction).
- Missed `:question` → fire now IFF **(a)** the next regular question occurrence is AFTER the next deadline occurrence, and **(b)** now + 2h ≤ next deadline occurrence — where *deadline* = next occurrence of `lockCron` when the game has one, else `revealCron` (both parsed with `cron-parser` in the game's timezone, knowledge trivia already has in `buildGameSpecs`). Guard (a) replaces any "skip the next run" mechanism: when the next natural fire precedes the deadline, that fire covers the day and catch-up would only create a duplicate.
- Missed `:prep` → never fired (the question prompt falls back to inline generation).
- Owner DM (`sdk.dmOwner`) ONLY on the lost-quiz path (question missed but guards failed) — successful lock/reveal catch-ups stay silent. DM text goes through `sdk.t()` with en + fr entries (direct-to-Slack path).

A full-day outage resolves correctly with no cross-fire state: lock finds nothing new, reveal empty-skips, the question hits guard (a) and becomes an owner DM.

### D6 — Config: `cron.catchUp.delayMinutes`, fail-fast

New optional block under `config.cron`: `catchUp?: { delayMinutes?: number }`, default 3, validated fail-fast at boot (integer ≥ 0; 0 = dispatch on next tick of the event loop after scheduler start, useful in tests). No enable/disable flag: with no handlers registered the dispatch is a no-op, and plugins opt in by registering.

## Risks / Trade-offs

- [Off-day interaction] A slot missed because the bot was down on a configured off-day would be reported by `missedRuns` (downtime prevented the `skipped` run from recording `lastRunAt`). → Trivia's guard (a) self-corrects the common daily case (the next natural fire precedes the deadline → no catch-up), and `runCronJobNow`'s `skipDates` gate blocks fire-now on a day that is itself an off-day.
- [Jitter imprecision] `missedRuns` compares canonical slots while jittered jobs record `lastRunAt` at the jittered fire time. A slot whose jittered fire was pending at shutdown may be classified either way. → Accepted: trivia jobs don't use jitter; consumers treat the list as advisory.
- [Boot loops] A crash-looping process re-runs handlers every boot. → The 3-minute delay means a tight crash loop never reaches dispatch; a slow loop re-fires, but `markJobStarted` on the first fire advances `lastRunAt`, so subsequent boots see no missed run.
- [Session cost at boot] Catch-up fires open real Claude sessions minutes after boot. → Sequential dispatch (per plugin, per game, per fire) bounds concurrency to 1.
- [Hook misuse] `onDelayedBoot` is general-purpose; a slow handler delays later plugins' handlers. → Documented contract; errors are isolated per handler; no timeout in v1 (same trust level as plugin init).
- [Multi-day gaps are lost by design] Only one catch-up question ever fires; skipped days are reported, not backfilled. → Explicit user decision ("better to skip days and have only one").

## Migration Plan

No persisted-schema change, no migration. Deploy is additive: absent config block → default 3-minute delay with zero registered handlers on non-trivia deployments (no behavior change). Rollback = redeploy previous image.

## Open Questions

None — design settled during exploration with the user.
