# Tasks

## 1. Plugin config: `reporting` block

- [x] 1.1 Add `IdlerReporting` interface + `reporting?: IdlerReporting` to `src/plugins/idler/types.ts`; remove top-level `reportingChannel`/`summaryHour`.
- [x] 1.2 In `config.ts`, add the `reporting` zod object (`channel` optional, `tickUpdates` enum default `"none"`, `summary` boolean default `true`, `summaryHour` int 0–23 default 9).
- [x] 1.3 Add the `preprocess` shim lifting legacy top-level `reportingChannel`/`summaryHour` into `reporting` when the block is absent.
- [x] 1.4 Update `DEFAULT_CONFIG` (`reporting: { tickUpdates: "none", summary: true }`).
- [x] 1.5 Update `isOperational` to check `config.reporting?.channel`.
- [x] 1.6 Tests: new-shape parse + defaults, legacy back-compat lift, `isOperational` dormancy.

## 2. Plugin reconcile + prompts

- [x] 2.1 In `index.ts`, read `reporting.channel`/`reporting.summaryHour` everywhere the old fields were used.
- [x] 2.2 Map `tickUpdates`: `"optional"` → work spec as today; `"none"` → work spec `silent: true` (keep real `channel`), `submitResponseMode: "optional"`.
- [x] 2.3 Gate the summary spec: push it only when `reporting.summary !== false`.
- [x] 2.4 In `prompts/work.ts`, add no-narration framing for the silent (`"none"`) path; keep `record_activity` unconditional.
- [x] 2.5 Tests: reconcile matrix across the four `tickUpdates × summary` quadrants.

## 3. Plugin management surface

- [x] 3.1 Update the config-setting tool(s) to read/write the `reporting` block (omit-to-keep semantics); surface `tickUpdates`/`summary` in any view/list tool.
- [x] 3.2 i18n: add `sdk.t()` keys (en/fr) for any new reporting labels surfaced to Slack.

## 4. Core: silent change execution

- [x] 4.1 Add `silent?: boolean` to `CronJobSpec` (`src/plugins/sdk.ts`) and thread through `src/cronJobs.ts` / `src/cronScheduler.ts` into the fire context.
- [x] 4.2 Pass `silent` into `triggerChangeWorkflow` and onto `WorkerToolContext`.
- [x] 4.3 Suppress the `submit_response` delivery post when the run is silent (keep `handleAutoExecuteActions` running so the change still auto-executes).
- [x] 4.4 Make `report_status` (`src/tools/worker/reportStatus.ts`) a no-op (return success, no post) when the context is silent.
- [x] 4.5 Audit and guard any other change-lifecycle `chat.postMessage` on the cron→change→worker path (initial card, completion, monitor) against `silent`.
- [x] 4.6 Confirm `autoExecute.ts` channelless suppression is unaffected (real channel retained) — no change expected; assert via test.
- [x] 4.7 Tests: silent cron change creates commits/PR + ledger entry with zero `chat.postMessage`; non-silent regression unchanged.

## 5. Validate

- [x] 5.1 `openspec validate idler-reporting-controls --strict`.
- [x] 5.2 `npx tsc`, `npx oxlint`, `npx oxfmt --check`, `npm test`.
