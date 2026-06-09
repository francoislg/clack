## 1. Core scheduler: deterministic offset + jittered match window

- [x] 1.1 Add `jitterMinutes?: number` to the `CronJob` type (cron-job store / `src/sessions.ts` or wherever `CronJob` is defined) and to its create/update params.
- [x] 1.2 Persist/load `jitterMinutes`: include in serialized form when present, omit when unset; ensure legacy rows without the key load unchanged (no migration).
- [x] 1.3 Add a pure, dependency-free `seededOffset(jobId: string, prev: Date, jitterMinutes: number): number` helper in `src/cronScheduler.ts` — 32-bit hash (FNV-1a / xmur3-style) over `jobId + prev.toISOString()`, returns ms in `[0, jitterMinutes * 60_000)`.
- [x] 1.4 Update `matchesCron` to accept the job's `jitterMinutes` (and `jobId` for the seed); when set and non-zero, compute `effectivePrev = prev + seededOffset(...)` and test the shifted 60s window; compare the double-fire guard against `effectivePrev`. Replace the reserved forward-hook comment at `cronScheduler.ts:166`.
- [x] 1.5 Update the `tick()` call site to pass `job.id` + `job.jitterMinutes` into `matchesCron`.

## 2. Validation

- [x] 2.1 Add range validation for `jitterMinutes` at the create/CRUD boundary: integer in `[0, 30]`, reject negatives/non-integers/over-cap with a clear error.

## 3. Plugin reconcile passthrough

- [x] 3.1 Add `jitterMinutes?: number` to the `CronJobSpec` interface in `src/plugins/sdk.ts`.
- [x] 3.2 Validate `jitterMinutes` in `validateCronJobSpec` (skip-with-warning on invalid, mirroring other fields).
- [x] 3.3 Thread `jitterMinutes` through `reconcileCronJobs` create + in-place update with omit-to-leave semantics (mirror `name` / `submitResponseMode`).

## 4. casual-talk internal jitter

- [x] 4.1 Define an internal `CHATTER_JITTER_MINUTES` constant (below the 15-minute cadence) in casual-talk `index.ts`.
- [x] 4.2 Set `jitterMinutes: CHATTER_JITTER_MINUTES` on the `chatter` `CronJobSpec`. Do NOT add it to `CasualTalkConfig` or the config schema — jitter is the general cron primitive, consumed internally.

## 5. Tests

- [x] 5.1 Unit-test `seededOffset`: determinism (same inputs → same output across calls), range `[0, span)`, stability across a sweep of `now` within one occurrence, variance across distinct occurrences, and no gross clustering over many occurrences.
- [x] 5.2 Unit-test `matchesCron` with jitter: exactly one tick matches per occurrence (no multi-fire, no missed fire), double-fire guard holds, and `jitterMinutes` absent/`0` matches identically to today.
- [x] 5.3 Test `CronJob` persistence round-trip for `jitterMinutes` (present + omitted) and legacy-row load.
- [x] 5.4 Test `reconcileCronJobs` jitter passthrough: create-with, create-without, in-place update preserving `id`, clear-on-absent, invalid-value rejection not breaking sibling specs.

## 6. Verify

- [x] 6.1 Run `npx tsc`, `npx oxlint`, `npx oxfmt --check`, and `npm test`; fix any failures.
- [x] 6.2 Run `openspec validate add-cron-jitter --strict`.
