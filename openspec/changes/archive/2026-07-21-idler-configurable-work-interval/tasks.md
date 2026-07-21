# Tasks: idler-configurable-work-interval

## 1. Config schema & types

- [x] 1.1 Add `workEveryMinutes` to `IdlerConfig` in `src/plugins/idler/types.ts`
- [x] 1.2 Add `workEveryMinutes: z.number().int().min(5).max(60).refine(<divisor of 60>, …).default(30)` to `baseConfigSchema` in `src/plugins/idler/config.ts`, with the refine message listing the accepted values (`5, 6, 10, 12, 15, 20, 30, 60`)
- [x] 1.3 Add `workEveryMinutes: 30` to `DEFAULT_CONFIG`
- [x] 1.4 Tests in `config.test.ts`: absent field defaults to 30; a representative sample of valid divisors (`5`, `15`, `30`, `60`) accepted; `25` rejected with an error message that names the accepted divisor-of-60 set; `4` and `61` rejected

## 2. Cron construction

- [x] 2.1 Replace the `"*/15"` literal in `src/plugins/idler/index.ts` with `` `*/${config.workEveryMinutes}` ``
- [x] 2.2 Test: reconcile with `workEveryMinutes: 30` produces a work spec whose cron minute field is `*/30` (and `15` produces `*/15`) — assert via the specs passed to `reconcileCronJobs`; also assert the work spec's hour/day fields are unchanged from baseline (the cadence knob touches only the minute field)

## 3. Management tool

- [x] 3.1 Add a `workEveryMinutes` optional arg to `set_idler_config` in `src/plugins/idler/tools/management.ts` (int bounds in the arg schema + describe listing accepted divisors), merged like the sibling fields so the full-config re-validation applies the refine
- [x] 3.2 Tests in `tools/tools.test.ts`: knob persists the new value; invalid value (25) returns the validation error and does not save

## 4. Docs & verification

- [x] 4.1 Update the root `CLAUDE.md` "Idler plugin: off-hours autonomy" section (work cadence now configurable via `workEveryMinutes`, default 30, must be a divisor of 60) and mention the 15→30 default change
- [x] 4.2 Run `npx tsc`, `npx oxlint`, `npx oxfmt`, and `npm run test` — all green
- [x] 4.3 Validate the change: `openspec validate idler-configurable-work-interval --strict`
