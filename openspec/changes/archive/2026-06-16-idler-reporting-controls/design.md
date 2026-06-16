# Design

## 1. Config shape: grouped `reporting` block + back-compat

All "what/where the idler reports" knobs collapse into one block. `reportingChannel` and `summaryHour` move in; two new knobs join them.

```ts
interface IdlerReporting {
  /** Was top-level reportingChannel. Absent ⇒ idler dormant (isOperational false). */
  channel?: string;
  /** "none" (default): no per-tick Slack output. "optional": today's behavior. */
  tickUpdates: "none" | "optional";
  /** Whether the morning digest fires. Default true. */
  summary: boolean;
  /** Was top-level summaryHour. Hour [0..23] the digest fires; default 9. Only relevant when summary. */
  summaryHour?: number;
}

interface IdlerConfig {
  // … unchanged: enabled, workHours, syncHours, repoAllowlist, maxActions*, sources …
  reporting?: IdlerReporting;
}
```

**Why `channel` stays optional inside the block (not required):** the loader is fail-fast (`idlerConfigSchema.parse` throws). Today a missing `reportingChannel` makes `isOperational` return false and the plugin goes dormant — it does NOT throw. Making `reporting.channel` required would convert "no channel configured" from *dormant* into a *boot error*. Keep it optional; `isOperational` becomes `config.enabled && repoAllowlist.length > 0 && Boolean(config.reporting?.channel)`.

**Back-compat (the relocation is breaking for existing files).** Existing `data/plugins/idler/config.json` carries `reportingChannel`/`summaryHour` at the top level; under the new schema those are unknown/ignored and `reporting` is absent → the idler would silently lose its channel and go dormant. A zod `preprocess` on `idlerConfigSchema` lifts the legacy fields when the new block is absent:

```ts
const idlerConfigSchema = z.preprocess((raw) => {
  if (raw && typeof raw === "object" && !("reporting" in raw)) {
    const r = raw as Record<string, unknown>;
    const reporting: Record<string, unknown> = {};
    if (typeof r.reportingChannel === "string") reporting.channel = r.reportingChannel;
    if (typeof r.summaryHour === "number") reporting.summaryHour = r.summaryHour;
    return { ...r, reporting }; // tickUpdates/summary fall to schema defaults
  }
  return raw;
}, baseObjectSchema);
```

This keeps the change self-contained (no separate numbered migration). On the next `saveConfig` the file is rewritten in the new shape. Reasonable alternative considered and rejected: a numbered migration — heavier, and plugin config isn't on the core migration path.

**Defaults.** `DEFAULT_CONFIG.reporting = { tickUpdates: "none", summary: true }` (channel/summaryHour absent ⇒ dormant until an admin sets a channel). Note the default `"none"` is a **behavior change** from today's implicit per-tick posting — intentional, per the proposal.

## 2. Reconcile wiring (plugin-local)

In `index.ts`:

- **Summary spec** — push it only when `config.reporting?.summary !== false`. When `summary: false`, the summary cron spec is simply not reconciled. `reconcileCronJobs` is idempotent, so toggling off later removes it.
- **Work spec** — map `tickUpdates`:
  - `"optional"`: `channel: reporting.channel`, `submitResponseMode: "optional"` (today).
  - `"none"`: `channel: reporting.channel` **and `silent: true`** (new flag, §3), `submitResponseMode: "optional"`. The channel stays the *real* reporting channel so change auto-execution is not treated as channelless; the `silent` flag suppresses the actual posts. The work prompt also gets a no-narration framing under `"none"` (don't compose chatter; just record_activity and, when implementing, the change action).
- `summaryHour` read from `reporting.summaryHour ?? 9`; `reporting.channel` read everywhere `reportingChannel` was.

The activity ledger (`record_activity`) is unconditional in the work prompt — it is written under both `tickUpdates` values, so the summary (when on) always has material.

## 3. Core capability: silent change execution

### The coupling we must break

A work tick reaches Slack via two independent paths:

1. `submit_response` delivery — the change-trigger message (+ any narration). `auto: true` change actions ride on this posted message (`handleAutoExecuteActions` runs after it posts).
2. Worker `report_status` → `client.chat.postMessage({ channel: ctx.channelId })` — direct, not gated by `submitResponseMode`.

Today's two modes couple posting to execution:

```
real channel  →  posts visible   +  change auto-executes
channelless   →  posts skipped   +  change auto-execution DISABLED (autoExecute.ts:176)
```

`tickUpdates: "none"` needs the missing quadrant — **posts skipped + change auto-executes**.

### Decision: explicit `silent` flag, keep a real channel

Add `silent?: boolean` to `CronJobSpec` (→ `CronJob` → the fire's session/trigger context). The work spec keeps `channel: reporting.channel` (a *real* channel), so:

- `autoExecute.ts:176`'s `isChannellessChannelId(channelId)` is **false** → change auto-execution proceeds **unchanged**. We do **not** touch the channelless-suppression logic.
- The `silent` flag guards the post sites:
  - `submit_response` delivery: skip the `chat.postMessage` of the response message. `handleAutoExecuteActions` still runs (it reads `stagedIntents`, not the posted message), so the change still executes.
  - `report_status` (`worker/reportStatus.ts`): no-op (return `{ success: true }` without posting) when the worker context is silent.
  - Any other change-lifecycle status post (initial card / completion / monitor notice) honors the flag — audit all `chat.postMessage` sites on the cron→change→worker path.

Threading: `CronJobSpec.silent` → cron job record → fire context → `triggerChangeWorkflow(intent, { …, silent })` → `WorkerToolContext.silent` → `report_status` guard.

**Why a flag, not a `silent:<jobId>` sentinel channel:** a sentinel would reuse the `isChannellessChannelId` guard pattern but (a) requires a *distinct* sentinel + new `isSilentChannelId` checks at every guarded site, and (b) muddies the channel identity (the channel really *is* the reporting channel — summary posts there). An explicit boolean states intent — "execute, don't post" — and leaves the channelless machinery alone. Rejected alternative: overload `submitResponseMode: "skipped"` — it replaces the schema with `{ skip_response: true }`, which removes the change action entirely, so IMPLEMENT becomes impossible.

### What is NOT suppressed

GitHub-side effects are untouched: the worker still pushes branches, opens PRs, posts PR review comments / `@claude review this`. "Silent" means *Slack-silent*. The PR's existence is recorded to the ledger and reported by the summary (when on).

## 4. Edge cases

- **Fully silent (`none` + `summary: false`)**: nothing is ever posted to Slack; `reporting.channel` is unused but stays required for operation (dormant if absent). Documented, not special-cased.
- **Switching `optional` → `none` mid-window**: hot-reload re-reconciles; in-flight changes already executing finish under their original (non-silent) context — acceptable, the next fire is silent.
- **`summary: false` with a non-empty ledger**: the ledger is still cleared on the *next* summary fire only if summary runs; with summary off it simply accumulates and is read on re-enable. Confirm the ledger has bounded growth or is cleared on window boundaries regardless — if not, note as a follow-up (out of scope here).

## 5. Testing

- Config: parse new block + defaults; `preprocess` lifts legacy `reportingChannel`/`summaryHour`; `isOperational` reflects `reporting.channel`.
- Reconcile matrix: each `tickUpdates × summary` quadrant produces the expected spec set (work spec `silent` flag; summary spec present/absent).
- Core silent execution: a silent cron change executes (commits/PR created, ledger entry written) with **zero** `chat.postMessage` calls; `report_status` no-ops; non-silent path posts exactly as before (regression).
