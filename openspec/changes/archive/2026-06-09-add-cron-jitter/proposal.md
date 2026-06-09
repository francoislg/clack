## Why

Plugin-driven scheduled posts (casual-talk especially) always fire on the canonical cron slot — every quarter hour lands exactly on `:00 / :15 / :30 / :45`. Over time the regularity reads as robotic: a human watching the channel notices the bot only ever speaks on the clock. We want each fire's wall-clock minute to vary so the cadence feels organic, without touching the cron expression (which must stay canonical for Home Tab display and inspection). This hook was explicitly designed-for but deferred in both the `channelless-cron-jobs` and `add-casual-talk-plugin` changes — this change builds it.

## What Changes

- Add an optional `jitterMinutes?: number` field to the `CronJob` data model (persisted, round-trips, omitted when absent) and to the `CronJobSpec` plugin contract so plugins can opt in.
- Extend the scheduler's match logic so that when `jitterMinutes` is set, the 60-second matching window is shifted forward by a **deterministic per-occurrence offset** in `[0, jitterMinutes)` minutes — seeded on `job.id + the canonical occurrence time` so every tick in that occurrence computes the same offset (exactly one tick fires) while distinct occurrences vary.
- Keep the canonical cron expression untouched — jitter applies only to the match window, never to the stored/displayed expression.
- Preserve the existing double-fire guard and concurrency guard with no behavioral change for jobs that omit `jitterMinutes` (default: no offset, identical to today).
- Pass `jitterMinutes` through `reconcileCronJobs` (create + in-place update, clear-on-absent semantics) so plugin-managed jobs can carry it.
- Have the casual-talk plugin set `jitterMinutes` on its `chatter` cron spec from an **internal constant** in its own code. Jitter is NOT exposed as a casual-talk config field — the casual plugin simply consumes the general cron primitive.

## Capabilities

### New Capabilities

_None._ This is an additive enhancement to the existing scheduling system.

### Modified Capabilities

- `cron-messages`: the `CronJob` data model gains an optional `jitterMinutes` field (load/persist/round-trip), and the Tick-Based Scheduler's cron-matching requirement gains a jittered-window match rule with a deterministic per-occurrence offset.
- `plugin-cron-reconciliation`: the `CronJobSpec` interface gains `jitterMinutes?: number`, passed through to `createJob` and in-place updates with the same omit-to-leave resolution as other optional spec fields.
- `casual-talk-plugin`: the plugin sets a fixed internal `jitterMinutes` constant on its `chatter` cron spec so casual posts no longer always land on the canonical quarter-hour. No new config surface.

## Impact

- **Code:** `src/cronScheduler.ts` (`matchesCron` + a new pure offset helper; replaces the reserved forward-hook comment at the matching block), the `CronJob` type and persistence (`src/cronJobs.ts`), `CronJobSpec` + `validateCronJobSpec` + `reconcileCronJobs` in `src/plugins/sdk.ts`, and the casual-talk plugin (`src/plugins/casual-talk/index.ts` sets an internal jitter constant on its spec).
- **APIs / contracts:** additive optional fields only; no breaking changes. Jobs and specs that omit `jitterMinutes` behave exactly as today.
- **Data:** existing `cron-jobs.json` rows load unchanged (field defaults to absent); no migration required.
- **Out of scope:** the "burn-down counter" / even-distribution mechanism floated alongside casual-talk's `weekly` die variance — that addresses how *often* a job posts, not *when on the clock*, and is a separate change.
