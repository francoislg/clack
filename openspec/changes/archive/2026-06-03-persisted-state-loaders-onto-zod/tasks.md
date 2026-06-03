## 1. Characterization gate (write first)

- [x] 1.1 The existing loader test suites (`roles.test.ts` 55, `userPreferences.test.ts`, `workers/persistence.test.ts` 19) serve as the characterization baseline (valid/partial/missing/corrupt → defaults/`[]`/`{}`); confirmed green before the migration
- [x] 1.2 Folded-in guards descoped (see §3); their existing tests (`changes/persistence.test.ts` 66, `cronJobs.test.ts` 63) remain the baseline and stay green
- [x] 1.3 Baseline confirmed green (217 loader tests)

## 2. Schemas + loader cutover (GOOD candidates)

> On any `safeParse` failure below, log a warning formatted with `zodErrorToResult(parsed.error, "<loader>").error` (per design Decision 4) and return the existing fallback — never throw.

- [x] 2.1 `workers/persistence.ts`: `persistedWorkerZod` + `workersStateZod` replace the four `is*` guards in `loadPoolState` and `readWorkerSidecar`; `fromPersisted` keeps the ISO-date→`Date` coercion (byte-equal); failure → log + `[]`/`null`
- [x] 2.2 `roles.ts`: `rolesConfigZod` with `.default()` per field replaces `JSON.parse` + `?? DEFAULTS`; failure → `DEFAULT_ROLES`
- [x] 2.3 `userPreferences.ts`: `preferencesMapZod` strips the inert `dmOptOut` (not modeled → zod drops it); failure → `{}`; per-key read defaults unchanged. Added tests: dmOptOut stripping + invalid-shape → `{}`

## 3. Thin guards — assessed, left as-is (descoped during implementation)

> On inspection, neither is the "elaborate hand-rolled validation" this sweep targets — both are already minimal, clean guards. Migrating them to zod is cosmetic churn (and `changes/persistence` would force an awkward `.passthrough()` + cast for no behavioral gain). Left unchanged.

- [x] 3.1 `changes/persistence.ts` `isValidSessionState`: a 3-field presence type-guard — kept as-is (not elaborate validation; zod conversion adds no value and risks stricter behavior)
- [x] 3.2 `cronJobs.ts` `submitResponseMode`: a single `Set.has` enum check inside `sanitizeLoadedJobs` — kept as-is (already minimal)

## 4. Green gate

- [x] 4.1 `npx tsc` clean
- [x] 4.2 `npx oxlint` + `npx oxfmt` clean on changed files
- [x] 4.3 `npm test` (vitest) green — full suite 5298 passing; the existing loader suites (which exercise valid/partial/missing/corrupt) stayed green = parity, plus new dmOptOut-stripping + invalid-shape cases
- [ ] 4.4 `graphify update .` — DEFERRED while concurrent sessions (casual-talk, config) are mid-flight, to avoid bundling their work into the tracked graph
