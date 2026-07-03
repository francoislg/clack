# Tasks — add-cron-catch-up-on-boot

## 1. Config

- [x] 1.1 Add `catchUp?: { delayMinutes?: number }` to the `cron` config type in `src/config.ts` AND to the cron block's zod validation in `src/configZod.ts` (fail-fast: integer ≥ 0, default 3); expose a `getCronCatchUpDelayMinutes()` accessor in `src/config.ts`
- [x] 1.2 Unit tests: accessor default (3) when block absent, explicit value honored via accessor, `-1` / non-integer rejected with formatted zod error

## 2. Core: missed-run computation

- [x] 2.1 Create `src/cronCatchUp.ts` with `computeMissedRuns(job, now)`: iterate canonical cron occurrences in `job.timezone` from `max(lastRunAt ?? createdAt, now − 14d)` to `now`, exclude occurrences ≤ `lastRunAt`, cap at 100; return `Date[]`; disabled jobs return `[]`
- [x] 2.2 Unit tests: single missed slot after downtime, empty when slot fired, disabled job → `[]`, never-run job bounded by 14-day lookback + 100 cap, timezone-sensitive expression, invalid cron expression → `[]` + logged error

## 3. Core: delayed-boot dispatch

- [x] 3.1 Add a handler registry + `dispatchDelayedBoot()` in `src/cronCatchUp.ts`: sequential await in registration order, per-handler try/catch with logged errors
- [x] 3.2 In `src/lifecycle.ts`, arm the dispatch timer immediately after the `startCronScheduler(client)` call (line ~154) using `getCronCatchUpDelayMinutes()`; clear it in the same stop path that calls `stopCronScheduler` (shutdown + soft restart re-arm)
- [x] 3.3 Unit tests with `vi.useFakeTimers()`: fires once after delay, fires on every (re)start, cancelled by stop before delay, error in first handler doesn't starve second, `delayMinutes: 0` dispatches immediately

## 4. SDK surface

- [x] 4.1 Add `onDelayedBoot(handler)` to `ClackSdk` in `src/plugins/sdk.ts` — registers into the `cronCatchUp` registry, tagged with the plugin's ownerKey for log attribution
- [x] 4.2 Add `missedRuns(specKey)` — resolve the job via `findByPluginOwner(ownerKey)` + specKey match (unknown/foreign → reject with error naming the specKey), return `{ lastExpectedRuns }` from `computeMissedRuns`
- [x] 4.3 Add `runCronJobNow(specKey)` — same owner-scoped resolution, then `executeJob(job, client)` with NO `asOf` (skipDates gate, `markJobStarted`, run history all apply); reject with a descriptive error when no Slack client is available; await completion (wired as an `executeCronJob` dep bound at the `loadAndInstallPlugins` call sites to avoid the sdk→cronScheduler module cycle)
- [x] 4.4 Unit tests (`sdk.test.ts` pattern, mocked boundaries): owner scoping rejects foreign specKey, `runCronJobNow` routes through the executeJob binding without `asOf`, null-client rejection, `missedRuns` passthrough of computed dates

## 5. Trivia catch-up handler

- [x] 5.1 Create `src/plugins/trivia/catchUp.ts`: per-game sequential pipeline `:lock` → `:reveal` → `:question` (each step: `missedRuns` non-empty → act, awaited); `:prep` never fired
- [x] 5.2 Implement the question guards: deadline = next occurrence of `lockCron ?? revealCron` (cron-parser, game timezone); fire only if next `questionCron` occurrence > deadline occurrence AND `now + 2h ≤ deadline`; at most one question fire per game per boot
- [x] 5.3 Implement the lost-quiz owner DM via `sdk.dmOwner`: add a key (`catchup.quiz_lost`) with `{game}` and `{dates}` placeholders to `src/plugins/trivia/i18n/strings.ts` (`en` + `fr`) and resolve via `sdk.t()`
- [x] 5.4 Register the handler from trivia plugin init (`sdk.onDelayedBoot`) next to the existing reconcile call
- [x] 5.5 Unit tests (mock the SDK): pipeline order (reveal awaited before question), games sequential, prep ignored, guard (a) rejects when next fire precedes deadline, guard (b) rejects inside 2h window, `lockCron` absent → `revealCron` deadline, multi-day gap fires once, lost-quiz DM sent with game + dates, successful catch-up sends no DM, missed lock/reveal fire unconditionally with no DM

## 6. Docs & verification

- [x] 6.1 Update CLAUDE.md: cron section (catch-up hook dispatch + config knob) and trivia section (catch-up behavior, one-fire-max, owner DM)
- [x] 6.2 `npx tsc`, `npx oxlint`, `npx oxfmt` on touched files, `npm test`
- [x] 6.3 `openspec validate add-cron-catch-up-on-boot --strict`
