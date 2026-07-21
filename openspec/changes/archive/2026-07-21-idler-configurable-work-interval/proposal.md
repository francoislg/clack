# Proposal: idler-configurable-work-interval

## Why

The idler's work-fire cadence is a hardcoded `"*/15"` literal (`src/plugins/idler/index.ts:175`) — 48 fires per 12-hour night. One measured night (2026-07-20) cost $64.12, and per-fire cost is dominated by re-reading the assembled prompt prefix, so the fire *count* is a first-order cost lever. Halving the cadence roughly halves the nightly bill with no structural change, and different deployments legitimately want different paces.

## What Changes

- New config field `workEveryMinutes` on the idler config (integer, minutes between work fires inside `workHours`), **default 30** — a deliberate behavior change from today's fixed 15.
- Accepted values are divisors of 60 within [5, 60] (`5, 6, 10, 12, 15, 20, 30, 60`) so the cadence tiles each hour evenly; non-divisors are rejected at validation time rather than silently snapped.
- `src/plugins/idler/index.ts` builds the work cron from the config value instead of the literal.
- `set_idler_config` gains a `workEveryMinutes` knob; changes hot-reload through the existing `config.json` watcher → re-reconcile path (no soft restart).
- Sync, discovery, summary, and anchor scheduling are untouched — the minute field is independent of the hour-level window math.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `idler-plugin`: the work task fires every `workEveryMinutes` minutes (configurable, default 30) instead of a fixed ~15; the config surface gains the validated `workEveryMinutes` field.

## Impact

- `src/plugins/idler/config.ts` — schema field + `DEFAULT_CONFIG`.
- `src/plugins/idler/types.ts` — `IdlerConfig` member.
- `src/plugins/idler/index.ts` — cron expression from config.
- `src/plugins/idler/tools/management.ts` — `set_idler_config` knob.
- Tests: `config.test.ts` (validation incl. divisor rejection), `tools.test.ts` (knob), reconcile-path assertion that the work spec uses the configured minute field.
- Deployed configs without the field parse to 30 — the intended new default; operators wanting the old pace set `workEveryMinutes: 15`.
