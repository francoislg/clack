## 1. Gating characterization test (write first)

- [x] 1.1 Add `src/cronJobs.quarantine.test.ts` with an injected/temp state path. Fixture: a state file with N valid jobs + 1 invalid job (e.g. missing required `timezone`).
- [x] 1.2 Document (comment) that the OLD loader returned `[]` for this fixture; the new test asserts the loader returns exactly the N valid jobs (not N+1), the invalid job is NOT in the returned list, and it IS in `quarantinedJobs`.
- [x] 1.3 Assert `saveState` round-trips `quarantinedJobs` untouched across a load→save→load cycle; and assert a clean state (no quarantine) omits `quarantinedJobs` from the written JSON (not an empty array).
- [x] 1.4 Assert scheduler isolation: `getEnabledJobs()`/`getJobs()` never return a quarantined job.
- [x] 1.5 Assert total-`JSON.parse` failure: writes a `cron-jobs.corrupt-*` snapshot, freezes persistence (a subsequent `saveState` does NOT overwrite the original), returns empty live jobs.
- [x] 1.6 Assert freeze clears: after a frozen load, a subsequent successful load of a repaired file clears `persistenceFrozen` and a following `saveState` writes normally; and re-arms across a restart while the file stays corrupt.

## 2. Per-element loader + quarantine (`src/cronJobs.ts`)

- [x] 2.1 Add `quarantinedJobs?: unknown[]` to the `CronJobState` interface and a permissive `quarantinedJobs: z.array(z.unknown()).optional()` to the top-level file schema (graceful reader — never rejects).
- [x] 2.2 Replace the whole-collection `safeParse` in `loadJobs()` with a per-job `cronJobZod.safeParse` walk; valid → `jobs`, invalid → `quarantinedJobs` (verbatim, never dropped). Merge any pre-existing on-disk `quarantinedJobs` array into the result. Carry `quarantinedJobs` on the in-memory `cached` state.
- [x] 2.3 Update `saveState` to serialize `{ jobs, quarantinedJobs }`, round-tripping the quarantine untouched (pulled from `cached` when the caller passes only `{ jobs }`); omit `quarantinedJobs` when empty. Scheduler-facing queries return only the live `jobs` array — structural isolation, no per-job flag.

## 3. Total-failure freeze guard (`src/cronJobs.ts`)

- [x] 3.1 In the `catch` for `JSON.parse`/unreadable top level: copy the file to `cron-jobs.corrupt-<ts>.json` (best-effort; failure logged, not fatal), set an in-memory `persistenceFrozen` flag (set even if the copy fails), return empty live jobs.
- [x] 3.2 Make `saveState` a no-op (log error + return) while `persistenceFrozen` is set. On process restart the flag resets to `false`, but a still-corrupt file re-triggers the freeze on the next load — the original is never overwritten across restarts.
- [x] 3.3 Clear `persistenceFrozen` on the next successful full load; `clearCronJobsCache()` also resets it (fresh-process semantics). Export `isCronPersistenceFrozen(): boolean` for the Home Tab banner.

## 4. Owner notification (reuse quarantine-notifier pattern)

- [x] 4.1 Add `src/cronQuarantineNotifier.ts` modeled on `src/workers/quarantineNotifier.ts` (DI'd `getOwnerUserId`/`sendOwnerDm`, best-effort, never throws): one DM listing each quarantined job's id (fallback to name/index when absent), failing field path, and error; a single DM on persistence-freeze naming the `.corrupt-*` file. Wired into the load path via `setCronQuarantineNotifier` (registration keeps `cronJobs.ts` free of the Slack layer — no import cycle).
- [x] 4.2 Fire the notification from the load path, fire-and-forget. Route DM strings through `t()` with new `cron.quarantine.*` keys in `en.ts`/`fr.ts` (i18n parity test passes).
- [x] 4.3 Unit-test `src/cronQuarantineNotifier.test.ts`: DM composed for the quarantine case and the freeze case; a `null` owner or a failing `sendOwnerDm` is swallowed (no throw).

## 5. Home Tab quarantine panel + freeze banner

- [x] 5.1 Render a "Quarantined schedules" section in `src/slack/homeTab.ts` only when `quarantinedJobs` is non-empty; per entry show summary (id/name if present in the raw object else index, failing field, error) + Retry (`cron_quarantine_retry`) + Delete (`cron_quarantine_delete`) buttons. Admin-gated (rendered only for `userIsAdmin`); non-admins see no section. Labels through `t()`.
- [x] 5.2 Render a freeze banner when `isCronPersistenceFrozen()` is true (admin), stating scheduling is paused until `cron-jobs.json` is repaired.
- [x] 5.3 Add the `cron_quarantine_retry` handler in `registerHomeTabHandler` (`src/slack/handlers/homeTab.ts`), co-located beside the sibling worker-quarantine `clack_clear_quarantine` action so it reuses `publishHomeView` + the handler deps: re-run validation via `retryQuarantinedJob`; on success it rejoins `jobs`, on failure it stays quarantined (module rolls back if the save fails). Admin-gated via `await userCanEditConfig(userId)`.
- [x] 5.4 `cron_quarantine_delete` handler (admin-gated): `deleteQuarantinedJob` — the only removal path, no automatic pruning.
- [x] 5.5 Wire the new `retryQuarantinedJob`/`deleteQuarantinedJob` into `HomeTabDeps` (handler) and `getQuarantinedJobSummaries`/`isCronPersistenceFrozen` into `HomeTabDeps` (render). Register `registerCronQuarantineNotifier` from `src/slack/app.ts`. (Also fixed the pre-existing broken `clack_clear_quarantine` gate — it called an async permission check un-awaited with a role instead of a userId, so it never blocked.)
- [x] 5.6 Test the panel rendering (`src/slack/homeTab.test.ts`: hidden when empty, shown with id/field/error + both buttons, freeze banner, non-admins excluded) and the handlers (`src/slack/handlers/homeTab.test.ts`: Retry/Delete delegate with the parsed index, malformed value ignored, both gated).

## 6. Green gate

- [x] 6.1 `npx tsc` clean
- [x] 6.2 `npx oxlint` + `npx oxfmt` clean on changed files
- [x] 6.3 `npm test` (vitest) green — new quarantine test + notifier test + Home Tab panel/handler tests + existing cronJobs/homeTab tests + i18n parity
- [x] 6.4 `graphify update .` (coordinate timing before staging `graphify-out/`)
