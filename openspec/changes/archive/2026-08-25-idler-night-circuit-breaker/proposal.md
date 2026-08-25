# Proposal: idler-night-circuit-breaker

## Why

When consecutive work fires find nothing to do, the rest of the night is very likely empty too — external sources (humans posting in channels, tracker updates, PR comments) don't produce new work while everyone is asleep. Yet the idler keeps firing every interval, paying the full fire cost each time. After N consecutive empty fires, remaining work fires in the same window should cost near-zero. **Depends on `idler-cheap-first-work-fire`**, which defines and writes the empty-fire signal this change consumes.

## What Changes

- **Circuit breaker state** in `data/plugins/idler/breaker.json` (introduced by the cheap-first change): `{ windowKey, consecutiveEmpty, pendingAsync }`, graceful zod reader (bad/absent file → `{ consecutiveEmpty: 0 }`, never a crash).
- **Trip condition:** `consecutiveEmpty >= stopAfterEmptyRounds` for the current window. Once tripped, each subsequent work fire early-exits at the very top — read the tiny state file, `skip_response`, done (a fraction of a normal fire). The cron layout is untouched (no spec mutation mid-night; early-exit, not cron-pause).
- **Pending-async awareness** — the caveat that makes the heuristic safe: the idler's own async triggers (posting "@claude review this" and reading the result on a later fire) DO produce overnight work. An empty fire only increments the counter when there is **no pending async work**; a fire that queues an async trigger sets `pendingAsync`, and the breaker never trips while it's set.
- **Reset conditions:** (a) a new work window opens (`windowKey` = the date the current window opened); (b) a discovery/deep sync fire surfaces new ledger units; (c) a pending async trigger resolves into workable state; (d) any productive fire resets `consecutiveEmpty` to 0.
- **Config:** `stopAfterEmptyRounds` on `idlerConfigSchema` — int in [0, 10], default 2; `0` disables the breaker. Exposed on `set_idler_config`; read live at tool-call time, so edits apply on the next fire with no reconcile.

## Capabilities

### New Capabilities

_None (the breaker consumes and extends `idler-empty-fire-signal`, introduced by `idler-cheap-first-work-fire`)._

### Modified Capabilities

- `idler-empty-fire-signal`: gains the trip/reset/pending-async semantics on top of the raw write.
- `idler-plugin`: the work-task requirement gains scenarios — tripped-breaker fires early-exit near-free; the breaker never trips while async work is pending; sync-discovered units lift the breaker.

## Impact

- `src/plugins/idler/config.ts` + `types.ts` — `stopAfterEmptyRounds` field.
- `src/plugins/idler/tools/management.ts` — `set_idler_config` knob.
- `src/plugins/idler/prompts/work.ts` + behavior topic — top-of-fire breaker check, counter update rules.
- Breaker module from the cheap-first change — trip/reset logic + tests.
- No core/SDK changes; no cron layout changes. False-stop downside is bounded: the idler idles until the next sync fire re-primes the ledger, which is the intended quiet-night behavior anyway.
