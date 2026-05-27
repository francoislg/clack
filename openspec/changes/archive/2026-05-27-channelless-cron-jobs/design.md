## Context

The cron-job system in Clack assumes every scheduled job has a pre-bound destination channel. `CronJob.channel` is a required `string`. `CronJobSpec.channel` is validated as a Slack channel ID by `validateCronJobSpec` in `src/plugins/sdk.ts`. The scheduler's dispatch path passes `channelId` to `processMessage`, the delivery context derives `post_to` availability and the `submit_response` schema from that channel, and the Home Tab renders `<#channel>` mentions on every schedule row.

The `casual-talk` plugin (its own change proposal) needs a schedule that fires every 15 minutes during work hours but decides the destination channel **at fire time** by reading recent activity across a configured list of candidates. The channel choice cannot live on the persisted cron job — it changes from one fire to the next.

We could solve this just inside the plugin (e.g., the plugin's prompt hard-codes the channel list and an "anchor channel" placeholder gets stored on the cron job, ignored at fire time), but that's a leaky model: the persisted `channel` would lie about where messages actually go, the Home Tab row would point to the wrong place, and replay semantics would break. Making `channel` truly optional in the core is the honest fix and is a capability other plugins can reuse later.

## Goals / Non-Goals

**Goals:**

- Allow `CronJob` and `CronJobSpec` to omit `channel`. The absence is the explicit contract for "this job decides delivery at fire time."
- When channel is absent, mechanically prevent text delivery via `submit_response` (force the `"skipped"`-shape Zod schema) so the wrong path is unrepresentable.
- Preserve every existing behavior for channel-bound jobs — same persistence, same scheduler dispatch, same schema, same Home Tab rendering.
- Make the Home Tab tolerant of channelless rows (fallback label, no crash).
- Honor channelless jobs on `run_scheduled_message_now` replay.
- Leave the door open for a future `jitterMinutes?: number` on `CronJob` without committing v1 to it.

**Non-Goals:**

- Per-channel candidate-list semantics in core — the candidate list is a plugin concern, embedded in the prompt by the plugin.
- Static (no-prompt) channelless jobs — `staticMessage` jobs must have a channel; there is no Claude session to decide a destination.
- Channel selection helpers, ranking heuristics, or a "best channel picker" tool — that's also a plugin concern.
- A core-level "candidate channels" field on `CronJob` — adding it would push the plugin's data model into the core for no reason. The prompt is the right carrier.
- Jitter / variance in next-fire compute — designed-for, not built.

## Decisions

### Decision 1: Make `channel` optional on `CronJob` rather than introduce a new "channelless job" subtype

`CronJob` already has a number of optional fields (`oneShot`, `staticMessage`, `skipConditions`, `submitResponseMode`, `skipDates`, `requiredTools`, etc.). Adding "optional channel" follows the same shape and keeps the data model single-typed. The alternative — a discriminated union `ChannelBoundCronJob | ChannellessCronJob` — would force every call site (CRUD, dispatch, Home Tab, replay, all tests) to branch on the variant, even where it doesn't care. Optional-channel is simpler and scales with the actual divergence (only the `submit_response` schema and the Home Tab row really branch).

**Alternatives considered:**

- Discriminated union: rejected — high churn for low payoff; ergonomically worse for the 95% of code paths that don't care which kind a job is.
- Sentinel value (e.g., `channel: "__channelless__"`): rejected — encodes the meaning in a string nobody recognizes, and `isChannelId` would have to special-case it. Optional is type-honest.
- New CronJob type altogether: rejected — duplicates 20+ fields. Not warranted by the single field that differs.

### Decision 2: The `submit_response` schema is `"skipped"`-shape whenever the delivery context has no channel — regardless of the persisted `submitResponseMode`

This is the linchpin of the design. When a cron job has no channel, there is *no destination* for `submit_response`'s `text` / `blocks` / `additional_messages`. We could rely on the prompt to tell Claude "don't try to deliver via `submit_response` — use `post_to` instead." But that's a discipline check — prompts drift, and Claude's behavior under stress (long sessions, partial-context recovery) won't always honor it.

Making the Zod schema mechanically exclude those fields turns the wrong move into an *unrepresentable input*. Claude gets one option for terminating the run (`skip_response: true`) and one option for delivering (`post_to {channel, text}`). The contract is enforced at the tool boundary, not in the persona text.

**Alternatives considered:**

- Honor persisted `submitResponseMode` (channelless + `"always"` → schema has `text` but no channel target → runtime error): rejected — surfaces the failure at the wrong layer (after Claude has spent tokens drafting a payload). Schema rejection is earlier and faster.
- Require plugins to set `submitResponseMode: "skipped"` explicitly on channelless specs: rejected — redundant. Channelless + non-`"skipped"` is incoherent, so the type system / runtime should just decide it. (We do still propagate the field in reconcile for clarity, but the channelless rule wins regardless.)

### Decision 3: Channels stay in the plugin's prompt, not in a core "candidates" field

The casual-talk plugin needs to give Claude a list of candidate channels with metadata (Slack `purpose`/`topic`, recent messages, optional `promptSuggestion`). One option is to add `candidateChannels?: string[]` to `CronJob` and have the scheduler enrich/inject them. Another is to keep the list purely in the prompt and let plugins assemble it however they like.

Plugins assemble. Reasons:

- The shape of "candidate channel metadata" varies across plugins (one plugin wants Slack metadata + last-5-messages; another might want activity scores; another might want per-channel tags). Encoding a single shape in core blocks divergence.
- The casual-talk plugin already owns the config that lists channels — moving the list into the cron-job record duplicates state.
- The prompt is the natural place for plugin-specific narration ("post here if it's a memes channel...") — separating the channel list from the prompt that describes how to choose makes the contract harder to read.

The cost is that the core has no idea which channels a channelless job might post to. The Home Tab can't show "intended targets." For casual-talk that's acceptable — `data/plugins/casual-talk/config.json` is the canonical source. Admins read it there.

### Decision 4: `staticMessage` jobs cannot be channelless

A static job posts a fixed string via `chat.postMessage`. There is no Claude session to pick a destination. We reject `createCronJob` calls that have `staticMessage` and no `channel`. This is enforced in `createJob` (boundary), not at the type level (the type stays `channel?: string` because dynamic jobs may omit it). The combined invariant is documented in the cron-messages spec.

### Decision 5: `replaceResponseTs` is unsupported for channelless jobs

`run_scheduled_message_now` accepts `replaceResponseTs` to delete a prior bot post before firing a new run. That delete needs a `(channel, ts)` pair — for a channel-bound job, the channel is `job.channel`. For a channelless job, the prior post's channel was decided at the prior fire time by Claude and is recorded only as part of the `runs[]` history (`responseTs` alone is stored, not the channel). Resolving the prior channel would require either (a) storing `responseChannel` per run alongside `responseTs`, or (b) scanning recent bot posts across all candidate channels.

(a) is feasible but expands the persistence model meaningfully and would require its own migration. (b) is racy and fragile. We pick the lighter option for v1: reject `replaceResponseTs` on channelless jobs with a clear error message. If real demand for replay-with-delete shows up, we add `responseChannel` per run as a follow-up change.

### Decision 6: Forward hook for `jitterMinutes` is documented but not built

The casual-talk discussion surfaced a future desire: perturb each fire's next-time by ±N minutes so the schedule feels organic. This would be additive: a `CronJob.jitterMinutes?: number` field, consulted by the scheduler when computing the next fire time. It does NOT modify the cron expression (the expression remains canonical for inspection / Home Tab description). v1 does not implement it; this design just notes that nothing in the channelless work closes the door.

### Decision 7: Persistence omits `channel` when absent

Mirrors the established pattern for other optional fields (`skipConditions`, `submitResponseMode`, `pluginManaged`, `specKey`, etc.). The persisted JSON simply lacks the key. Re-reconciling a previously-bound job with a channelless spec removes the key on the next write. No data migration is needed for existing rows — they all carry `channel`, and the round-trip preserves that.

## Risks / Trade-offs

- **[Risk]** Plugin authors confuse "channelless" with "static" — they create a static job and wonder why the channel-omitted spec fails. **Mitigation:** the rejection in `createJob` carries a clear, actionable error message; the spec documents the invariant; the SDK's `validateCronJobSpec` doesn't need to know (it accepts both shapes for dynamic specs — the boundary check fires in `createJob` only when a static spec arrives without a channel).
- **[Risk]** A bug in the schema selector branches on the wrong precedence (e.g., honors `submitResponseMode: "always"` for a channelless job and Claude tries to deliver `text`). **Mitigation:** unit tests for every combination (channel × `submitResponseMode`) of the schema selector, asserting the expected shape. The precedence rule is codified in the `submit-response-mode` spec delta.
- **[Risk]** Home Tab renderers crash on `<#undefined>` mention attempts. **Mitigation:** the rendering helper SHOULD already handle missing channel string defensively; we add an explicit test that asserts the fallback label appears and no Block Kit assertion fires.
- **[Trade-off]** `run_scheduled_message_now` with `replaceResponseTs` is rejected on channelless jobs — a regression for users who rely on this on plugin-managed jobs. **Trade-off accepted:** no plugin uses this combination today (plugin-managed jobs aren't replay-deleted in practice); we surface the limitation and revisit if needed.
- **[Trade-off]** Channelless jobs aren't discoverable by channel in `listCronJobs({ channel })`. **Trade-off accepted:** the filter is a query optimization, not a contract; channelless jobs simply won't appear in channel-scoped lookups. Admin / plugin lookups go by `plugin` field instead.
- **[Trade-off]** Replay on a channelless job will repeat the channel-selection logic from scratch — there's no "post to the same place as last time" affordance. **Trade-off accepted:** consistent with the model ("the cron is channelless"). If the calling user wanted a specific channel, they can edit the plugin config or use a different tool.

## Migration Plan

No data migration. Existing rows continue to carry `channel`. Reads / writes round-trip the new shape cleanly. The only `data/state/cron-jobs.json` impact is that newly-created channelless jobs persist without the key.

Rollback: revert the code changes. Existing channel-bound rows are unaffected. Any channelless rows that were persisted under the new code would, on rollback, fail validation when loaded (if the rollback restores `channel` as required). To make rollback safe, the loader after rollback would need to either drop those rows or treat them as data-error rows. For this change, the practical guidance is: don't enable casual-talk in production until the rollback window has passed. Channelless rows otherwise live only in the casual-talk plugin's reconcile output, which is regenerated on every plugin boot — disabling the plugin removes the rows on the next reconcile cycle.

## Open Questions

- Should the `data/state/cron-jobs.json` loader log an `info`-level line when it encounters channelless rows (to make the new shape visible in operator logs), or stay silent like other field omissions? Default: silent — consistent with the other optional fields.
- Should the Home Tab fallback label be a static string ("No bound channel — plugin-decided") or include the plugin name? Default: static, plugin name is already on the row. Easy to revisit.
