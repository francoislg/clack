## Context

Scheduled messages today identify themselves by a 12-character random UUID stored in `CronJob.id`. That id is the only handle:
- It is interpolated into Slack task cards via `clack.json` mappings (`"Cancelling scheduled message {id}"`).
- It is the lookup key passed to `cancel_scheduled_message`, `update_scheduled_message`, `run_scheduled_message_now`, and `get_scheduled_message_runs`.
- The Home Tab displays rows by channel + human-readable schedule + status only.

When a single channel hosts multiple schedules (very common once the trivia plugin opens 2 schedules per game), neither Claude's task cards nor the Home Tab help the viewer tell them apart. The fix is a decorative `name` that travels from creation site to every display site without becoming a parallel identity (no name-based lookups, no uniqueness enforcement).

## Goals / Non-Goals

**Goals:**
- Add a human-readable `name` field to scheduled messages and surface it everywhere they render: tool-call task cards, the Home Tab schedule sections, and the edit modal.
- Make naming pleasant at the creation boundary (Claude *must* author a name when calling `create_scheduled_message`) and at every user-facing edit (modal field is required).
- Let plugins (starting with trivia) attach descriptive names to their reconciled schedules.
- Keep the change additive — no migration, no breakage of existing persisted jobs.

**Non-Goals:**
- Name-based lookup or resolution. Claude continues to pass `id` to the by-id tools; `name` is decorative.
- Uniqueness enforcement (per user, per channel, or globally). Two schedules may share a name.
- Backfilling names for existing persisted jobs. Legacy rows render via fallbacks until someone edits them.
- Editing schedule names from outside the Home Tab / Claude. CLI tooling or REST surfaces are out of scope.
- New i18n strings for plugin-supplied names. Plugins author them in whatever language they target.

## Decisions

### Decision 1 — Required on create, optional in storage

`CronJob.name` is `string | undefined` in the persisted model so existing rows stay valid. The `create_scheduled_message` tool however lists `name` as a *required* zod field, and the tool description tells Claude to invent a 3-6 word descriptive label whenever the user hasn't supplied one. The edit modal makes the Name block required too, so the first time anyone edits a legacy nameless job they're forced to give it a name.

**Why not require it in storage too?** That would force a migration to backfill every existing job before boot — a runtime risk for zero user benefit, because the display fallbacks (`{name|id}`, conditional Home Tab prefix) render legacy rows just fine.

**Why not let Claude omit it on create?** Optional fields on `create_scheduled_message` are skipped under uncertainty; we want every *new* schedule to be named.

**Alternative considered — make `name` part of the lookup key (id-or-name string).** Rejected: it conflates identity with labels, requires uniqueness rules, and breaks idempotency for the same name reused in different channels. The args-enricher (Decision 3) gives us the display benefit without the cost.

### Decision 2 — Empty string on update clears the name

`update_scheduled_message` accepts `name?: string`. When `name` is `undefined`, the field is left untouched. When `name === ""`, the field is cleared (set back to `undefined`). This mirrors how the existing tool handles other clearable optional fields (`plugin`, `skipConditions`).

### Decision 3 — Args enricher hook for tool-label interpolation

`cancel_scheduled_message`, `update_scheduled_message`, `run_scheduled_message_now`, and `get_scheduled_message_runs` receive only `{ id }` from Claude. The label-mapping interpolator (`src/streaming/toolMappingLoader.ts → applyArgConfigs → interpolateLabel`) sees only those raw args. To make `{name|id}` resolve to the name, we need to *enrich* the args before interpolation.

We add a small per-tool enricher registry to `toolMappingLoader.ts`:

```ts
type ArgEnricher = (args: Record<string, unknown>) => Record<string, unknown>;
// Map<fullyQualifiedToolName, ArgEnricher[]>
const enrichers = new Map<string, ArgEnricher[]>();

export function registerArgEnricher(toolName: string, fn: ArgEnricher): void;
export function applyArgEnrichers(toolName: string, args): Record<string, unknown>;
```

Inside `resolve()` in `toolLabels.ts`, the enriched args are computed first, then passed to `applyArgConfigs`. The registry is process-global and idempotent (same key, same fn → no-op).

At app boot (one place — e.g. `src/streaming/index.ts` or wherever the streamer wires up), we register four enrichers that read from `cronJobs.ts`:

```ts
const enrich = (args: Record<string, unknown>) => {
  const id = String(args.id ?? "");
  const job = getJobByIdFromCache(id);
  return job?.name ? { ...args, name: job.name } : args;
};
registerArgEnricher("mcp__clack__cancel_scheduled_message", enrich);
registerArgEnricher("mcp__clack__update_scheduled_message", enrich);
registerArgEnricher("mcp__clack__run_scheduled_message_now", enrich);
registerArgEnricher("mcp__clack__get_scheduled_message_runs", enrich);
```

`getJobByIdFromCache` is a new synchronous accessor exported from `cronJobs.ts` that reads from the in-memory `cached` map without touching disk. It returns `null` when the cache is cold (caller falls through to `{id}`).

**Why sync, not async?** Tool-label generation is on the streaming hot path and downstream callers (`slackStreamer.ts`) are sync. Async would force a cascade through several call sites for a feature whose worst case is degraded label, not data loss.

**Why a registry, not hard-coded clack hooks in `toolLabels.ts`?** Keeps `toolLabels.ts` generic and avoids cyclic-import shape between `streaming/` and `cronJobs.ts`. Lets future features (e.g. reminder labels, plugin label enrichment) reuse the hook.

**Cold-cache fallback**: `loadJobs()` is invoked on boot from the cron scheduler and the Home Tab handler, so `cached` is warm whenever Claude is also running. If a tool fires before boot completes (impossible today), the fallback path produces `{id}` — same behavior as today.

### Decision 4 — Mapping templates use the `{name|id}` fallback

The label loader already supports `{argName|fallback}` syntax (see `interpolateLabel` in `toolMappingLoader.ts`). We change five templates in `data/default_configuration/tool_mapping/clack.json`:

```diff
-  "label": "Scheduling message to <#{channel}>"
+  "label": "Scheduling '{name}' to <#{channel}>"
-  "label": "Fetching runs for schedule {id}"
+  "label": "Fetching runs for schedule {name|id}"
-  "label": "Cancelling scheduled message {id}"
+  "label": "Cancelling scheduled message {name|id}"
-  "label": "Updating scheduled message {id}"
+  "label": "Updating scheduled message {name|id}"
-  "label": "Re-running scheduled message {id}"
+  "label": "Re-running scheduled message {name|id}"
```

`create_scheduled_message` uses `{name}` directly because `name` is required there. The other four use `{name|id}` to gracefully fall back for legacy nameless jobs.

`itemDetail` strings get the same treatment (`{name|id}` where they previously held `{id}`).

### Decision 5 — Home Tab single-line render

User-jobs section (currently):
```
<#channel> · <schedule>[ one-time][ · @creator][ status]
```

Post-change, when `job.name` is set:
```
*Morning PR roundup* — <#channel> · <schedule>[ one-time][ · @creator][ status]
```

When `job.name` is unset (legacy rows): unchanged.

Same prefix pattern in the Plugin Scheduled Messages section. The em-dash (`—`, U+2014) was chosen over a centered dot to differentiate the name boundary from the field separators that already use ` · `.

The render code in `buildScheduledMessagesSection` (`src/slack/homeTab.ts`) computes a `prefix = job.name ? \`*${escape(job.name)}* — \` : ""` and prepends it to the section's `text` field. Name is wrapped in Slack bold (`*…*`); any literal `*`, `_`, `~`, `<`, `>` characters in user-typed names are escaped via the existing mrkdwn-escape helper so a clever name cannot break the row layout.

### Decision 6 — Edit modal: required Name input above the channel block

Add a new `cron_name_block` input to `buildCronJobModal`:

```ts
{
  type: "input",
  block_id: "cron_name_block",
  label: { type: "plain_text", text: t("home.scheduled.name_label") },
  element: {
    type: "plain_text_input",
    action_id: "cron_name",
    max_length: 80,
    ...(job?.name && { initial_value: job.name }),
    placeholder: { type: "plain_text", text: t("home.scheduled.name_placeholder") },
  },
  hint: { type: "plain_text", text: t("home.scheduled.name_hint") },
}
```

The modal-submission handler reads `state.values.cron_name_block.cron_name.value`, trims whitespace, and passes it as the `name` parameter to `createJob` (on add) or `updateJob` (on edit). Empty string after trim is treated as a validation error and re-renders the modal with the error.

### Decision 7 — Plugin SDK `CronJobSpec.name`

Add `name?: string` to `CronJobSpec`. The SDK's `reconcileCronJobs` threads it into both `createJob` (new entries) and the in-place update branch (existing entries). The trivia plugin updates its reconcile call sites to populate `name` with the per-game label it already knows.

`name` stays optional on `CronJobSpec` (not breaking the contract for any out-of-tree plugins).

## Risks / Trade-offs

- **Risk: Cache miss on label enrichment leaks the UUID into a task card.** The `cached` map in `cronJobs.ts` is read-only after boot, and every tool that operates on cron jobs awaits `loadJobs()` somewhere upstream. The window where the cache is cold but Claude is firing a cron tool is effectively empty. **Mitigation:** the `{name|id}` template fallback means the worst case is "user sees the UUID like today" — no regression.

- **Risk: Long or adversarial names break Slack rendering.** A 500-character name in a Home Tab row would wrap onto multiple lines or trip the section-text length limit. **Mitigation:** the modal enforces `max_length: 80` on the name input; tool-side, the zod schema applies `.max(80)` too. The mrkdwn-escape pass keeps the bold markers intact regardless of name content.

- **Risk: Claude silently desyncs name vs prompt content.** A schedule named "Daily PR roundup" whose prompt was edited to do something else now misleads viewers. **Mitigation:** when `update_scheduled_message` is called with a new `prompt` but no `name`, the tool description warns Claude to reconsider whether the name still fits. Worst case, the name lies — but it's not a correctness bug.

- **Risk: The args-enricher hook is global mutable state.** Registering an enricher twice (or from a test) leaks across tests. **Mitigation:** the registry exposes a `clearArgEnrichers()` testing escape hatch; production registration is centralized in one boot site.

- **Trade-off: i18n surface grows by three keys.** Acceptable — three plain strings each in `en.ts` and `fr.ts`. The parity test catches any drift.

- **Trade-off: Plugin-supplied names are not localized.** A French-language deployment running the trivia plugin will see the plugin's English name. Accepted because the plugin authors the string, not the framework. Out-of-tree plugin authors can localize via their own `t()`-equivalent if they wish.

## Migration Plan

No runtime migration. Deployment steps:
1. Ship the change. Existing `cron-jobs.json` rows continue to load (name is absent → undefined).
2. The first time a user opens the Home Tab edit modal for a legacy nameless schedule, they're forced to enter a name before saving. The schedule's `name` field is then populated.
3. The first time the trivia plugin runs its `reconcileCronJobs` after deploy, its rows update in place (existing `pluginManaged === true` rows whose `specKey` matches gain a `name`).
4. No rollback complications — removing the change just leaves `name` fields hanging on persisted jobs as unread data.

## Open Questions

- Should we add the same `name` field to `Reminder` records (the parallel feature in `src/tools/actions/scheduleReminder.ts`)? Reminders have a simpler lifecycle and are queryable via `list_reminders`. **Out of scope for this change** — handle separately if the same surface problem manifests there.
