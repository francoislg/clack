# Tasks — add-trivia-off-days

## 1. Schema additions

- [x] 1.1 Add `OffDay` and `SkipDate` interfaces (`{ date: string; label: string }`) to `src/config.ts` and `src/cronJobs.ts` respectively. Keep them as separate names even though shapes match — they sit at different abstraction layers and one may diverge from the other.
- [x] 1.2 Add optional `offDays?: OffDay[]` to `TriviaConfig` in `src/config.ts`.
- [x] 1.3 Add optional `skipDates?: SkipDate[]` to `CronJob` in `src/cronJobs.ts` and to `CronJobSpec` in `src/plugins/sdk.ts`.

## 2. Config parsing & validation

- [x] 2.1 Add `parseOffDays` helper in `src/config.ts` that validates each entry: `date` matches `^\d{4}-\d{2}-\d{2}$` or `^\d{2}-\d{2}$`, represents a real calendar date (reject `02-30`, `13-01`, etc.), and `label` is a non-empty string. Drop invalid entries with `logger.warn` identifying the index and reason.
- [x] 2.2 Wire `parseOffDays` into the `TriviaConfig` parser so `config.trivia.offDays` is populated (or absent) after load.
- [x] 2.3 Tests in `src/config.test.ts`: absent field is valid; empty array is valid; valid mixed `YYYY-MM-DD` + `MM-DD` parses through; each invalid shape drops with a warning; mixed valid+invalid keeps valid entries.

## 3. Deterministic skip-date matcher

- [x] 3.1 Add `matchesSkipDate(entries, now, timezone) => SkipDate | null` in `src/cronScheduler.ts` (or a new `src/skipDates.ts` if it feels too crowded — leave to author judgement). Format `now` in `timezone` as both `YYYY-MM-DD` and `MM-DD` and compare against each entry's `date`. First match wins; return the entry so callers can log its `label`.
- [x] 3.2 Unit tests: exact date match; recurring `MM-DD` match; non-match; empty list; undefined list; timezone correctness (a moment that's Dec 24 in UTC but Dec 25 in `Australia/Sydney` matches a `12-25` entry).

## 4. Scheduler gate

- [x] 4.1 In `cronScheduler.ts:executeJob`, add the skip-dates gate immediately after `runningJobs.add(job.id)` and before calling `executeDynamicJob`. Use `asOf ?? new Date()` as the comparison time. On match: call `updateJobRunStatus("skipped", undefined, replayOf)`, log `info` with the matched label, delete the job if `oneShot`, and return early.
- [x] 4.2 Tests in `src/cronScheduler.test.ts`: skip-day fire records `status: "skipped"` and never invokes `processMessage`; non-skip-day fire still calls `processMessage`; one-shot job is deleted after a skip-day skip; `skipDates` AND `skipConditions` both present — `skipDates` wins (no Claude session opened); replay with off-day `asOf` skips, replay with normal `asOf` fires.

## 5. Wiring from trivia config to cron specs

- [x] 5.1 Update `buildGameSpecs` signature to accept `offDays: OffDay[] | undefined`. Propagate into each emitted spec's `skipDates`. When `offDays` is absent or empty, omit `skipDates` from the spec entirely (don't write empty arrays).
- [x] 5.2 Update the trivia plugin's init in `src/plugins/trivia/index.ts` to read `config.trivia.offDays` and pass it to `buildGameSpecs`.
- [x] 5.3 Verify `sdk.reconcileCronJobs` persists `skipDates` on the resulting `CronJob`s and reads them back across reload. Add a test if not already covered.
- [x] 5.4 Tests in `src/plugins/trivia/buildGameSpecs.test.ts`: with `offDays`, every spec carries `skipDates`; without `offDays`, no spec has `skipDates`; updating `offDays` and re-running reconcile updates `skipDates` on existing plugin-managed jobs without touching `runs[]` / `enabled` / `id`.

## 6. Spec updates

- [x] 6.1 Add the `skipDates` requirement + scenarios to `openspec/specs/cron-messages/spec.md` (handled by the delta in this change).
- [x] 6.2 Add the `trivia.offDays` requirement + scenarios to `openspec/specs/trivia-managed-schedules/spec.md` (delta in this change).
- [x] 6.3 Update `data/default_configuration/user/scheduling.md` to mention `skipDates` exists alongside `skipConditions`, and that for trivia it's configured via `trivia.offDays` (not directly per-job).

## 7. Validation

- [x] 7.1 Run `npx tsc` — no new type errors.
- [x] 7.2 Run `npm test` — all green; new tests cover the surface in §2.3, §3.2, §4.2, §5.4.
- [x] 7.3 Run `openspec validate add-trivia-off-days --strict` — passes.
- [x] 7.4 Run `npx oxlint` and `npx oxfmt --check` on touched files — clean.
