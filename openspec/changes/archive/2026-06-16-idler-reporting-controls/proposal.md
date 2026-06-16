## Why

The idler currently reports on a fixed cadence: the work fire posts per-tick progress to `reportingChannel` whenever it acts (review narration, change execution via `report_status`), and the summary fire always posts a morning digest. Operators want control over both channels of noise independently:

- Some want **no per-tick chatter at all** — the morning digest is enough. Today the work fire is wired `submitResponseMode: "optional"`, so it posts whenever it does something; there is no way to silence it while keeping it productive.
- Some want **only** the per-tick updates and **no** summary.
- A few want it **fully silent** — it opens PRs but says nothing in Slack, ever.

These are two orthogonal knobs (`tickUpdates`, `summary`) that today don't exist. Adding them also surfaces an architectural gap: a truly-silent work fire must still *execute changes*, but change auto-execution is currently coupled to visible Slack posting — the worker's `report_status` posts directly to the channel, and channelless dispatch disables change execution entirely. So "execute but post nothing" is an unrepresentable quadrant.

## What Changes

- Introduce a grouped **`reporting`** config block on `IdlerConfig` that absorbs the existing `reportingChannel` and `summaryHour` fields and adds two new knobs:
  - `reporting.channel` (was top-level `reportingChannel`; absent ⇒ idler dormant)
  - `reporting.tickUpdates: "none" | "optional"` — default `"none"`
  - `reporting.summary: boolean` — default `true`
  - `reporting.summaryHour?: number` (was top-level `summaryHour`; default 9)
- **Back-compat** for the relocated fields: the fail-fast loader gains a zod `preprocess` that lifts legacy top-level `reportingChannel`/`summaryHour` into `reporting.{channel,summaryHour}` when the new block is absent, so existing `data/plugins/idler/config.json` files keep working without a separate migration.
- `tickUpdates: "optional"` reproduces today's behavior exactly (work fire channel'd, `submitResponseMode: "optional"`, `report_status` posts).
- `tickUpdates: "none"` (the new default) makes the work fire **truly silent** per-tick: no narration, no `report_status`, no change-lifecycle cards — yet it still triages, reviews, and *implements* (opens PRs). Everything is recorded to the activity ledger and surfaces only in the summary (when enabled). This requires a new core capability: **silent change execution** — a cron job may run with all Slack output suppressed while change auto-execution still proceeds against its real channel.
- `summary: false` skips reconciling the summary cron spec entirely (plugin-local; no core change). The activity ledger is still written regardless, so re-enabling later loses nothing within the window.
- `reporting.channel` remains effectively required for operation (`isOperational` checks `config.reporting?.channel`; absent ⇒ dormant). It stays the re-enable sink even in the fully-silent (`none` + `summary: false`) combo.

The four quadrants of `tickUpdates × summary`:

| | summary: true | summary: false |
|---|---|---|
| **tickUpdates: "none"** (default) | quiet ticks + morning digest | fully silent — works, never speaks |
| **tickUpdates: "optional"** | granular ticks + digest (fullest) | granular ticks only |

Out of scope: changing the sync fire (already silent), the work cadence, the kind ladder, or the summary digest's contents.

## Capabilities

### New Capabilities
- `silent-change-execution`: a cron-triggered change action MAY execute with all Slack output suppressed (submit_response delivery, `report_status`, and change-lifecycle status posts) while still creating commits/PRs, when its cron spec is marked silent.

### Modified Capabilities
- `idler-plugin`: add a **Reporting controls** requirement (the `reporting` block, defaults, back-compat, the `tickUpdates`/`summary` matrix, ledger-always-recorded); modify **Three cooperating scheduled tasks** (work fire silent under `tickUpdates: "none"`; summary spec reconciled only when `summary: true`) and **Activity logging and summary digest** (digest gated by `summary`, ledger written regardless of `tickUpdates`).

## Impact

- Plugin config: `src/plugins/idler/types.ts` (`reporting` block), `src/plugins/idler/config.ts` (zod schema + `preprocess` back-compat + `DEFAULT_CONFIG` + `isOperational`).
- Plugin wiring: `src/plugins/idler/index.ts` (map `tickUpdates` → work spec silent flag + `submitResponseMode`; gate the summary spec on `summary`; read `reporting.channel`/`reporting.summaryHour`), `src/plugins/idler/prompts/work.ts` (no-narration framing under `"none"`).
- Plugin management surface: `set_idler_config` (and any reporting-specific setters) accept the new block; i18n labels if surfaced.
- Core silent execution: `src/plugins/sdk.ts` `CronJobSpec` (+ `src/cronJobs.ts` / `src/cronScheduler.ts` plumbing) carry a `silent` flag; `src/slack/handlers/autoExecute.ts` / the change-trigger delivery path suppress the `submit_response` post when silent; `src/tools/worker/reportStatus.ts` no-ops when silent; any change-lifecycle status post respects the flag.
- Tests: idler config parse/back-compat + reconcile matrix; core silent-execution (change runs, PR created, zero `chat.postMessage`).
- All prompt/contract edits are VIA-Claude path (English); config-tool labels surfaced to Slack go through `sdk.t()`.
