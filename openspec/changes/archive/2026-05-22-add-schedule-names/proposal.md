## Why

Scheduled-message task cards in Slack currently surface a 12-char UUID (e.g. `"Cancelling scheduled message a3f2b8c4e9d0"`), and the Home Tab lists each row by channel + schedule alone. With several schedules per channel (especially when plugins create multiple jobs in `#trivia`), users can't tell which schedule is which at a glance. A human-readable name solves the identification problem at every display site without adding a lookup layer.

## What Changes

- Add an optional `name?: string` field to the `CronJob` storage type and to `CronJobSpec` on the plugin SDK.
- **BREAKING** for Claude's tool surface: `create_scheduled_message` SHALL require a new `name: string` argument; the tool description nudges Claude to author a short descriptive label (3-6 words) every time. Pre-existing persisted jobs without a name continue to work — the field stays optional in storage.
- `update_scheduled_message` SHALL accept an optional `name?: string` argument (empty string clears).
- Tool-mapping label templates for `cancel_scheduled_message`, `update_scheduled_message`, `run_scheduled_message_now`, and `get_scheduled_message_runs` SHALL render `{name|id}` instead of `{id}`. `create_scheduled_message`'s template SHALL render the name directly (since `name` is required there).
- The Home Tab SHALL render the name (when set) as a bold prefix followed by an em-dash, in both the user-jobs and plugin-jobs sections, keeping each entry on a single line.
- The Home Tab edit modal SHALL include a required Name input block whose initial value is the current `job.name`; the first edit of a legacy nameless job thus forces a name onto it.
- The streaming tool-label layer SHALL gain a per-tool args-enricher hook so that the four lookup-by-id tools can interpolate `{name}` from the persisted job (read from the in-memory cron-jobs cache).
- The trivia plugin SHALL set `name` on its reconciled cron-job specs so its rows render with descriptive labels (e.g. `"Trivia: <game> — daily reveal"`).
- No data migration. Existing persisted jobs without `name` render unchanged via the `{name|id}` fallback and the conditional Home Tab prefix.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `cron-messages`: `CronJob` gains an optional `name` field; `CreateCronJobParams` and `UpdateCronJobParams` gain `name` (required on create going forward, optional patch on update).
- `scheduled-messages`: `create_scheduled_message` requires a new `name` argument; `update_scheduled_message` accepts an optional `name`. Empty string on update clears.
- `plugin-cron-reconciliation`: `CronJobSpec` gains an optional `name` field threaded into `createJob`.
- `tool-label-config`: a new per-tool args-enricher hook augments tool args with values derived from external state (e.g. looking up a `CronJob.name` by `id`) before label interpolation.
- `home-tab`: the Scheduled Messages and Plugin Scheduled Messages sections render `*<name>* — ` as a single-line prefix when set; the edit modal exposes a required Name input.

## Impact

- **Code**
  - `src/cronJobs.ts` — extend `CronJob`, `CreateCronJobParams`, `UpdateCronJobParams`; add a synchronous cache reader for use by the streamer.
  - `src/tools/actions/createScheduledMessage.ts` — add required `name` arg, thread it into `createJob`.
  - `src/tools/actions/updateScheduledMessage.ts` — add optional `name` arg, thread it through `updateJob`.
  - `src/plugins/sdk.ts` — extend `CronJobSpec` with optional `name`, thread into `createJob`.
  - `src/streaming/toolMappingLoader.ts` — add a per-tool args-enricher registry consulted before `applyArgConfigs`.
  - `src/streaming/toolLabels.ts` — call the enricher chain inside `resolve()`.
  - `src/slack/homeTab.ts` — render name prefix in both schedule sections; add name input block to `buildCronJobModal`; thread name through the modal-submission handler.
  - `src/slack/handlers/<cron handlers>` — accept the name input value on modal submission.
  - `data/default_configuration/tool_mapping/clack.json` — update 5 label templates to use `{name|id}` (or `{name}` for `create_scheduled_message`).
  - Trivia plugin source — pass `name` in its `reconcileCronJobs` specs.
- **i18n** — new keys `home.scheduled.name_label`, `home.scheduled.name_placeholder`, `home.scheduled.name_hint` (added to `en.ts` and `fr.ts`).
- **Tests** — coverage in `cronJobs.test.ts`, `createScheduledMessage.test.ts`, `updateScheduledMessage.test.ts`, `toolLabels.test.ts`, `toolMappingLoader.test.ts`, `homeTab` modal/section tests, `sdk.test.ts` for `reconcileCronJobs`.
- **No migration**. Storage shape stays backward-compatible; legacy rows render via fallbacks.
- **No new dependencies**.
