## Why

A new `casual-talk` plugin (see `add-casual-talk-plugin`) needs to fire on a schedule, evaluate multiple candidate channels at run time, and post to the most relevant one. The channel of delivery cannot be known when the cron job is reconciled — it's a per-fire decision. Today `CronJob.channel` and `CronJobSpec.channel` are required and validated as Slack channel IDs (`src/plugins/sdk.ts:510 validateCronJobSpec` and `src/cronJobs.ts`), so the whole scheduler/delivery pipeline assumes a pre-bound destination. Making `channel` optional unlocks plugin-decided routing while leaving the existing channel-bound path untouched, and the capability composes cleanly with other plugins that may later need the same shape.

## What Changes

- **CronJob data model**: `channel` becomes optional. Existing jobs that carry a channel string continue to work unchanged; new jobs MAY omit it.
- **CronJobSpec validation**: `sdk.reconcileCronJobs` accepts specs without a `channel`. When supplied, the existing `isChannelId` check still applies; when omitted, the check is skipped.
- **Scheduler dispatch**: when `job.channel` is absent, the scheduler builds a delivery context tagged as "channelless" — no bound destination. The Claude session runs normally; only the response schema changes.
- **`submit_response` schema (channelless)**: when no channel is bound on the delivery context, the schema MUST strip `text`, `blocks`, `actions`, `table`, `reactions`, `message`, `additional_messages`, `thread_replies`, `post_top_level`, and `disengage`, exposing ONLY `skip_response: z.literal(true)`. Functionally equivalent to `submitResponseMode: "skipped"` applied implicitly. `post_to` actions remain available and become the sole legitimate delivery path.
- **Delivery context for scheduled-channelless**: when `triggerType === "scheduled"` and no channel is bound, the delivery context tells Claude that `submit_response` is a run terminator only and `post_to {channel, text}` is the way to deliver.
- **Home Tab schedule rows**: render "No bound channel — plugin-decided" (or equivalent fallback) when the job has no `channel`.
- **`run_scheduled_message_now` (replay)**: when invoked on a channelless job, dispatches through the same channelless path. Replay does not require an `asOf`-time channel.
- **Persistence**: `data/state/cron-jobs.json` round-trips channelless jobs — `channel` is omitted from the serialized form when absent. Legacy rows continue to load with `channel` present and unchanged.
- **Design note (non-goal v1)**: leave room for a future `jitterMinutes?: number` field on `CronJob` that perturbs next-fire compute by ±N minutes per cycle. The cron expression stays canonical; jitter applies on top. Mentioned in `design.md` so v1 choices do not accidentally close that door.

## Capabilities

### New Capabilities

(none — channelless behavior layers onto existing capabilities)

### Modified Capabilities

- `cron-messages`: `Cron Job Data Model` — `channel` becomes optional. `Cron Job Execution` — when channel is absent, the run still uses `processMessage` but with a channelless delivery context and an effectively-skipped `submit_response` schema; delivery is via `post_to` actions or none. `On-Demand Cron Job Execution` — `run_scheduled_message_now` mirrors the channelless path on replay. Persistence rules updated to round-trip the absent `channel` cleanly.
- `plugin-cron-reconciliation`: `Declarative Reconcile API On ClackSdk` — `CronJobSpec.channel` becomes optional. Validation skips the `isChannelId` check when channel is absent; when supplied, the check applies unchanged.
- `submit-response-mode`: add a requirement that codifies the channelless-implicit-skipped rule (when delivery context has no bound channel, the schema variant matches `"skipped"` regardless of the cron job's persisted `submitResponseMode`).
- `delivery-context`: add a scenario for the scheduled-channelless case — `triggerType === "scheduled"` with no channel surfaces a delivery context that disables `submit_response` text delivery and points Claude to `post_to`.
- `home-tab`: Schedule rows tolerate a missing `channel` and render a fallback label without crashing.

## Impact

- **`src/cronJobs.ts`**: `CronJob.channel` typed `string | undefined`; `CreateCronJobParams.channel` becomes optional; load/save round-trips the absent field; `getJobByIdFromCache` and lookup paths unaffected (just type widening).
- **`src/plugins/sdk.ts` `validateCronJobSpec`**: when `spec.channel` is undefined, skip the `isChannelId` check; otherwise validate as today. `CronJobSpec.channel` typed `string | undefined`.
- **Scheduler / dispatch (likely `src/scheduler.ts` and `executeDynamicJob` callsite)**: build delivery context with channel `undefined` when the job has none. `processMessage` signature already accepts an optional channel in some triggers; surface the channelless case explicitly.
- **`submit_response` schema builder (`src/tools/presentation/submitResponse.ts` or wherever the schema variants are assembled)**: detect channel-absent delivery context and emit the `skipped`-shape schema. The persisted `submitResponseMode` field is still honored — channelless effectively forces the same outcome.
- **`src/slack/homeTab.ts`** (and helpers): render fallback row label when `job.channel === undefined`.
- **`run_scheduled_message_now` (`src/tools/actions/runScheduledMessageNow.ts`)**: do not reject channelless jobs; pass through to the same dispatch path.
- **Tests**: add coverage for the validator, scheduler dispatch, schema selection, Home Tab render, and replay. Channelless jobs flow end-to-end in unit tests for each touched module.
- **Specs**: deltas to `cron-messages`, `plugin-cron-reconciliation`, `submit-response-mode`, `delivery-context`, `home-tab`.
- **Downstream consumer**: `add-casual-talk-plugin` is blocked on this change for its `reconcileCronJobs` call (which omits `channel`).
- **No data migration needed**: existing rows keep their `channel`; the change is purely additive at the type and validation layers.
