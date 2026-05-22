## 1. Data Model

- [x] 1.1 Add optional `name?: string` field to the `CronJob` interface in `src/cronJobs.ts`.
- [x] 1.2 Add required `name: string` to `CreateCronJobParams`; thread it into the `createJob()` body so it's stored when set and omitted when not.
- [x] 1.3 Add optional `name?: string` to `UpdateCronJobParams`; in `updateJob()`, treat `undefined` as no-op, empty string (after trim) as clear, non-empty as overwrite.
- [x] 1.4 Export a synchronous `getJobByIdFromCache(id: string): CronJob | null` from `src/cronJobs.ts` that reads from the in-memory `cached` map and returns `null` when the cache is cold or no match is found.
- [x] 1.5 Add unit tests in `src/cronJobs.test.ts` covering: create-with-name, update-with-name (set/clear/no-op), legacy-load (no name field), `getJobByIdFromCache` warm/cold/miss cases.

## 2. Plugin SDK

- [x] 2.1 Add optional `name?: string` to `CronJobSpec` in `src/plugins/sdk.ts` with a doc comment describing the field's purpose (decorative label, 1-80 chars, surfaced in displays).
- [x] 2.2 Update `validateCronJobSpec` in `src/plugins/sdk.ts` to validate `name` when present: must be a string, must be 1-80 characters after trim. Skip the spec with a logged warning when invalid (matching existing error-handling pattern).
- [x] 2.3 In `reconcileCronJobs`, pass `spec.name` through to `createJob` for new entries, and apply it to the in-place update branch (omit when the spec has no `name`, leaving the existing persisted value untouched).
- [x] 2.4 Add tests in `src/plugins/sdk.test.ts` for: new spec with name, new spec without name, existing spec gains a name on re-reconcile, existing spec keeps its name when the new spec has no `name`, existing spec's name overwritten, invalid name rejected.

## 3. Tool-Label Args Enricher Hook

- [x] 3.1 In `src/streaming/toolMappingLoader.ts`, add a process-global registry `enrichers: Map<string, ArgEnricher[]>`. Export `registerArgEnricher(toolName, fn)`, `applyArgEnrichers(toolName, args): Record<string, unknown>`, and a test-only `clearArgEnrichers()`.
- [x] 3.2 `applyArgEnrichers` SHALL: iterate registered enrichers in insertion order, pass the running args through each, catch and log any thrown exception (falling back to the most recent valid args), and return the final args object. Make it idempotent on repeated registration of the same function reference.
- [x] 3.3 In `src/streaming/toolLabels.ts → resolve()`, call `applyArgEnrichers(toolName, toolArgs)` before `applyArgConfigs` so synthetic args reach interpolation.
- [x] 3.4 Add tests in `src/streaming/toolMappingLoader.test.ts` covering: registration, ordered composition, throwing enricher falls back gracefully, `clearArgEnrichers` resets state.
- [x] 3.5 Add tests in `src/streaming/toolLabels.test.ts` showing an enriched arg renders into a `{name|id}` template.

## 4. Wiring the cron-name Enricher

- [x] 4.1 In an existing boot site (e.g. wherever the streamer is initialized or where `cronJobs` is first loaded), register four enrichers — one each for `mcp__clack__cancel_scheduled_message`, `mcp__clack__update_scheduled_message`, `mcp__clack__run_scheduled_message_now`, `mcp__clack__get_scheduled_message_runs` — each calling `getJobByIdFromCache(args.id)` and returning `{ ...args, name: job.name }` when a job with a `name` is found, otherwise returning args unchanged.
- [x] 4.2 Identify the right boot site: must run after `loadJobs()` warms the cache and before any cron tool fires. Document the choice in a one-line comment at the registration call site.

## 5. Tool Schemas (Claude-facing)

- [x] 5.1 In `src/tools/actions/createScheduledMessage.ts`, add `name: z.string().min(1).max(80)` to the input schema as a required field. Update the tool description to nudge Claude to author a short descriptive label (3-6 words) when the user has not specified one explicitly.
- [x] 5.2 Thread the resolved `name` into the `deps.createJob(...)` call. Include `name` in the text result object returned to Claude (alongside `id`, `channel`, `schedule`, `nextRun`).
- [x] 5.3 Update `src/tools/actions/createScheduledMessage.test.ts` to cover: required-name rejection, name persisted, name appears in tool result.
- [x] 5.4 In `src/tools/actions/updateScheduledMessage.ts`, add `name: z.string().max(80).optional()` to the input schema. Document in the field description: omit to leave unchanged, empty string to clear, non-empty to overwrite.
- [x] 5.5 Thread the `name` argument into `updateJob(...)` with the same trim-then-classify rule (`undefined` = no-op, `""` = clear, otherwise overwrite).
- [x] 5.6 Update `src/tools/actions/updateScheduledMessage.test.ts` to cover: omitted name leaves existing value, empty name clears, non-empty name updates, too-long name rejected.

## 6. Tool Mapping Templates

- [x] 6.1 In `data/default_configuration/tool_mapping/clack.json`, update the `create_scheduled_message` template to `"Scheduling '{name}' to <#{channel}>"` and matching `itemDetail` to `"Schedule '{name}' to <#{channel}>"`.
- [x] 6.2 Update the `get_scheduled_message_runs` template to `"Fetching runs for schedule {name|id}"` and `itemDetail` to `"Fetch runs for {name|id}"`.
- [x] 6.3 Update the `cancel_scheduled_message` template to `"Cancelling scheduled message {name|id}"` and `itemDetail` to `"Cancel {name|id}"`.
- [x] 6.4 Update the `update_scheduled_message` template to `"Updating scheduled message {name|id}"` and `itemDetail` to `"Update {name|id}"`.
- [x] 6.5 Update the `run_scheduled_message_now` template to `"Re-running scheduled message {name|id}"` and `itemDetail` to `"Re-run {name|id}"`.

## 7. Home Tab Rendering

- [x] 7.1 In `src/slack/homeTab.ts → buildScheduledMessagesSection`, compute a `namePrefix` per row: when `job.name` is set, `\`*${escapeMrkdwn(job.name)}* — \`` else empty string. Prepend it to the section's `text` value in BOTH the user-jobs loop and the plugin-jobs loop. Confirm `escapeMrkdwn` (or the project's existing equivalent) is imported/used.
- [x] 7.2 In `buildCronJobModal`, prepend a new input block `cron_name_block` (action_id `cron_name`, type `plain_text_input`, `max_length: 80`, required). Set `initial_value: job.name` when defined. Pull label/placeholder/hint via `t("home.scheduled.name_label")`, etc.
- [x] 7.3 In the cron job modal submission handler (in `src/slack/handlers/`), extract `state.values.cron_name_block.cron_name.value`, trim it, validate non-empty (return a block-level error response if empty), and pass it through as `name` to `createJob` / `updateJob` based on whether it's an add or edit.
- [x] 7.4 Add Home Tab tests covering: section row renders `*<name>* — <#channel> · …` when name is set; section row renders unchanged when name is absent; modal includes `cron_name_block` with `initial_value`; modal submission with empty name returns validation error; modal submission with valid name passes through to `createJob`/`updateJob`.

## 8. i18n Keys

- [x] 8.1 Add three new keys to `src/i18n/strings/en.ts`: `home.scheduled.name_label` (e.g. "Name"), `home.scheduled.name_placeholder` (e.g. "Morning PR roundup"), `home.scheduled.name_hint` (e.g. "Short label shown in the Home Tab and tool task cards.").
- [x] 8.2 Add the parallel French translations to `src/i18n/strings/fr.ts`. Verify the parity test passes.

## 9. Trivia Plugin

- [x] 9.1 In the trivia plugin's `reconcileCronJobs` call sites, populate the new `name` field with a per-game descriptive label (e.g. `\`Trivia: ${game.name} — daily question\``, `\`Trivia: ${game.name} — daily reveal\``).
- [x] 9.2 Verify in a manual or test run that the trivia plugin's Home Tab rows now render the per-game name prefix and the existing `(via trivia)` plugin suffix.

## 10. Verification

- [x] 10.1 Run `npm test` and confirm all tests pass (including the i18n parity test and the existing cron-jobs / streaming / home-tab tests).
- [x] 10.2 Run `npx oxlint <changed files>` and resolve any flags.
- [x] 10.3 Run `npx oxfmt <changed files>` and re-stage.
- [x] 10.4 Run `npx tsc` and confirm no type errors.
- [x] 10.5 Run `openspec validate add-schedule-names --strict` and confirm it passes.
- [x] 10.6 Smoke test against a real Slack workspace: open the Home Tab, click Edit on an existing legacy nameless schedule (modal forces a name), save, confirm the row now renders the `*<name>* — ` prefix. Create a new schedule via Claude and confirm Claude includes a `name` arg by default. Run a cron-tool action (e.g. cancel) and confirm the task card label shows the name rather than the UUID.
