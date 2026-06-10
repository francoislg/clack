## 1. Gate (existing tests + fixtures)

- [x] 1.1 Confirm the existing loader tests are green as the baseline: `workers/quarantine.test.ts`, `autoRespond.test.ts`, `cronJobs.test.ts`, `changes/persistence.test.ts`, `userSkills.test.ts`, `skillPlugins.test.ts`
- [x] 1.2 Add a loader test for `errorReports.readErrorReport` (valid → record; missing/corrupt → `null`) — the one surface with no test today
- [x] 1.3 For each loader, add a fixture round-trip over a representative real-world saved file (incl. legacy shapes: nameless cron jobs, partial auto-respond state) to prove the schema accepts existing on-disk data

## 2. Migrate each loader (independent, one at a time)

- [x] 2.1 `workers/quarantine.ts` — `QuarantineRecord` schema; replace `isQuarantineRecord`; keep `null` fallback
- [x] 2.2 `autoRespond.ts` — `AutoRespondState`/`AutoRespondRule[]` schema; replace `as Partial<…>`; keep `[]` fallback
- [x] 2.3 `cronJobs.ts` — `CronJobState`/`CronJob`/`CronRun`/`SkipDate` schemas, `submitResponseMode` as `z.enum`; replace `as Partial<…>` + `sanitizeLoadedJobs`; keep `[]` fallback + legacy nameless jobs
- [x] 2.4 `changes/persistence.ts` — `PersistedSessionState` schema; replace `isValidSessionState`; keep `null` fallback + debug log
- [x] 2.5 `userSkills.ts` — `UserSkillMeta` schema; replace `isValidMetaShape`; optionally express `validateSlug`/`validateDescription` as shared `z.string()` rules, preserving the `ValidationResult` envelope
- [x] 2.6 `skillPlugins.ts` — narrow manifest schema; replace the blind `as` cast; keep basename/zero-count defaults
- [x] 2.7 `errorReports.ts` — `ErrorReport` schema; replace the blind `as` cast; keep `null` fallback
- [x] 2.8 Each migration uses `safeParse` + `zodErrorToResult` from `src/plugins/zodResult.ts` for log wording; remove the now-dead `isObject`/`isValid*` guards

## 3. Green gate

- [x] 3.1 `npx tsc` clean
- [x] 3.2 `npx oxlint` + `npx oxfmt` clean on changed files
- [x] 3.3 `npm test` (vitest) green — all loader tests + new `errorReports` test + fixture round-trips
- [ ] 3.4 `graphify update .` (coordinate timing with concurrent sessions before staging `graphify-out/`)
