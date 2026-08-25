# Proposal: idler-cheap-first-work-fire

## Why

In one measured night of idler activity, most work fires found no fresh work. A fire's cost is roughly `prefix × turns` — and today's work prompt attaches heavy MCP integrations and walks the full step ladder *before* discovering there is nothing to do, paying full price for a no-op. Inverting the order — check the ledger cheaply first, end the fire immediately when nothing is fresh — cuts the dominant cost without losing any triage/review capability.

## What Changes

- Restructure the work-fire prompt (`src/plugins/idler/prompts/work.ts`) and the idler behavior topic so the FIRST step is a cheap freshness check: `list_top_ideas` + cursor comparison, using only always-on plugin tools — **before** any `attach_integration` call.
- When no unit has fresh work, the fire ends immediately via `submit_response({ skip_response: true })` (already mechanically available: the work spec's `submitResponseMode: "optional"` sets `allowSkip`). Ending on turn ~2 instead of turn ~10 saves most of the fire's cost.
- When a unit IS fresh, the fire proceeds as today — but attaches integrations lazily, only after a specific unit is selected (full narrowing of *which* server is a separate change, `idler-narrow-mcp-attach`).
- Record a machine-detectable **empty-fire signal** as a dedicated state write (`data/plugins/idler/breaker.json`), NOT in the activity log (the morning summary clears activity, so it cannot carry cross-fire state). The signal is defined as: *no code-changing action AND no fresh triage/review performed.* This file is the contract the future `idler-night-circuit-breaker` change consumes; this change only writes it.
- The freshness check trusts the ledger as recently primed by the sync fires (deep/discovery/light) — the work fire does not re-discover work itself.

## Capabilities

### New Capabilities

- `idler-empty-fire-signal`: the machine-readable empty/productive outcome record each work fire writes (`breaker.json` shape, graceful zod reader, window keying, reset semantics).

### Modified Capabilities

- `idler-plugin`: the work-task requirement changes — the "may do nothing" scenario becomes "MUST determine it has nothing to do via the cheap-first path (no MCP attach, immediate skip)" plus a new scenario ordering the freshness check before any integration attach.

## Impact

- `src/plugins/idler/prompts/work.ts` — step reordering, skip-first contract.
- `src/plugins/idler/instructions.ts` (behavior topic) — lazy-attach + cheap-first rules.
- `src/plugins/idler/` new module for the breaker-file write (graceful zod schema per project conventions for persisted state).
- No config schema changes, no cron layout changes, no core/SDK changes.
- Prompt-only + one new plugin state file: existing `work.test.ts` grows assertions; new unit tests for the breaker-file writer.
