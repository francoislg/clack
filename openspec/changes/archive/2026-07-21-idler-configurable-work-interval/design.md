# Design: idler-configurable-work-interval

## Context

`buildWindowCron(w, minuteField)` (`src/plugins/idler/heuristic.ts:57`) already takes the minute field as a parameter — the interval is only hardcoded at the single call site in `index.ts:175` (`buildWindowCron(config.workHours, "*/15")`). The idler config is a **fail-fast** zod loader (`loadConfig` throws on parse failure; plugin goes inert with an `sdk.error`), and `set_idler_config` re-validates the merged config through the same schema before saving. Config edits hot-reload via `sdk.watchFile("config.json", …)` → `reconcile()`, which rebuilds all cron specs; `sdk.reconcileCronJobs` is idempotent, so a cadence change lands on the next reconcile without a restart.

Cost motivation (measured 2026-07-20 night): 48 work fires at median $1.15 ≈ $64/night. Fire count scales linearly with the minute cadence.

## Goals / Non-Goals

**Goals:**
- Make the work-fire cadence a validated config field, default `30`.
- Keep the change entirely inside the idler plugin (config + one call site + one tool knob + tests).
- Predictable cadence: every accepted value tiles the hour evenly.

**Non-Goals:**
- No changes to sync/discovery/summary scheduling or the anchor math (hour-level, independent of the minute field).
- No per-window or per-day cadence variation.
- No other cost levers (cheap-first fires, MCP narrowing, circuit breaker — separate changes).

## Decisions

**1. Field name & shape: `workEveryMinutes: number` (top-level config field).**
Mirrors the existing `syncEveryHours` naming, so the config reads as a pair of cadence knobs. Alternative — nesting under `workHours` — rejected: `workHours` is a reused window shape (`windowSchema`) shared with `syncHours`; a cadence member would corrupt the shared type.

**2. Validation: integer in [5, 60] AND a divisor of 60 (`5, 6, 10, 12, 15, 20, 30, 60`), enforced with a zod `refine`.**
A cron minute field `*/N` where N doesn't divide 60 produces an uneven wrap gap (e.g. `*/45` fires at :00, :45, :00 — a 15-minute gap every other fire). Rejecting non-divisors keeps the cadence honest. Alternatives considered: (a) accept-and-warn — the fail-fast loader has no warn channel that reaches the admin, and a logged warning nobody reads is worse than a clear validation error surfaced by `set_idler_config`; (b) silent snapping to the nearest divisor — violates least surprise. The refine message names the accepted values.

**3. Default `30`, applied to existing configs via zod `.default(30)`.**
This intentionally halves the pace of any deployment that never set the field. It's the point of the change (cost), it's the documented new default, and restoring the old pace is a one-field edit (`workEveryMinutes: 15` via `set_idler_config`). Alternative — defaulting to 15 to preserve behavior — rejected: it would make the cost fix opt-in and forgotten.

**4. Cron construction: template the existing call site — `buildWindowCron(config.workHours, `*/${config.workEveryMinutes}`)`.**
`buildWindowCron` already accepts the minute field; no signature change. `*/60` is unusual but valid cron (equivalent to `0` — fires at :00 of each window hour); accepted for the "hourly" case rather than special-casing.

**5. Tool surface: add `workEveryMinutes` to `set_idler_config` with the same bounds described in its zod arg.**
The tool merges then re-validates through `idlerConfigSchema`, so the divisor refine applies automatically; the tool's own arg schema repeats the numeric bounds for a better inline error. Hot-reload is free: `saveConfig` writes `config.json`, the watcher fires, `reconcile()` rebuilds the work spec.

## Risks / Trade-offs

- **[Behavior change on deploy: 15 → 30 for existing configs]** → Deliberate and documented in the proposal; called out in the change summary so the operator can set 15 back if the faster pace matters more than cost.
- **[Fail-fast loader means a hand-edited invalid value (e.g. 25) makes the idler inert]** → Same failure mode as every other invalid idler config field today; `set_idler_config` validates before saving so the tool path can't produce it, and the refine's error message lists the accepted values for the hand-edit case.
- **[Longer cadence delays pickup of fresh work by up to `workEveryMinutes`]** → Acceptable by design — the idler is an off-hours background worker; nothing it does is latency-sensitive.

## Migration Plan

None needed: zod `.default(30)` covers absent fields on read; no persisted-state shape changes; no data migration. Rollback = revert the commit (configs that explicitly set `workEveryMinutes` would then fail `.strict()`-less parsing harmlessly — the field is simply ignored by the old schema).

## Open Questions

_None — all decisions above are settled; the change is mechanical._
