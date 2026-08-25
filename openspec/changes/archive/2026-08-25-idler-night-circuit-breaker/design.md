## Context

This change layers trip/reset semantics on the empty-fire signal shipped by `idler-cheap-first-work-fire`: the `breaker.json` state file (`src/plugins/idler/breaker.ts`), the `record_fire_outcome` tool, and the code-level productive reset inside `record_activity`. Constraints carried over from that change:

- **Cron prompts are static** — per-fire state (tripped or not) must reach Claude through a tool result, not the prompt.
- **No SDK pre-fire predicate exists** — a cron fire always spawns a Claude session. The floor for a tripped fire is the early-exit turns (~$0.10), not $0; going lower would need a core/SDK change, which is out of scope.
- The work spec's `submitResponseMode: "optional"` makes skip the mechanical exit.

## Goals / Non-Goals

**Goals:**

- After `stopAfterEmptyRounds` consecutive empty fires in one window, each remaining work fire ends in ~2 turns.
- The breaker never trips while the idler's own async loops (posted `@claude review this` triggers) have unread output pending.
- The breaker lifts automatically — with zero prompt cooperation — when sync surfaces new work.

**Non-Goals:**

- No cron layout mutation mid-night (early-exit, not cron-pause).
- No summary-fire changes (the digest does not report breaker state).
- No core/SDK changes.

## Decisions

### 1. Trip status is surfaced through `list_top_ideas`

The `list_top_ideas` result gains a `nightBreaker: { tripped, consecutiveEmpty, threshold }` field, present only when the feature is enabled (`stopAfterEmptyRounds > 0`). The handler loads config at call time (`loadConfig` — a file read, giving hot-reload for free), reads the breaker state, and evaluates: tripped ⇔ stored `windowKey` matches the current window AND `consecutiveEmpty >= stopAfterEmptyRounds`. Work fires already call `list_top_ideas` first, so the tripped path costs exactly that call plus the skip — no extra turn. Sync and interactive callers see the advisory field and ignore it.

Alternatives rejected: a dedicated `check_night_breaker` tool (adds a turn to every work fire, tripped or not); embedding state in the prompt (impossible — static).

### 2. Early-exit is a prompt contract, and it fails open

The work prompt's step 1 gains: if `nightBreaker.tripped`, end the fire immediately via skip — no `record_fire_outcome` call (the state is already past the threshold; there is nothing to add), no attach, no ledger writes. If Claude ignores the flag, the fire proceeds as a normal cheap-first fire and pays the old empty price — a cost regression, never a correctness issue. Stated cost floor: at `workEveryMinutes: 30` over a 15-hour overnight window, a fully-tripped night still pays ~30 × ~$0.10 ≈ $3.

### 3. `pendingAsync` is a keyed set, not a boolean

`record_fire_outcome` gains `outcome: "empty" | "async-triggered"` plus `asyncKey` (required with `"async-triggered"`, e.g. `"org/repo#123"`); the handler adds the key to `pendingAsync` with set semantics. A boolean cannot distinguish which trigger resolved when several are in flight. Interactions:

- **Empty while async pending**: recording `"empty"` with a non-empty `pendingAsync` does NOT increment — the counter freezes (not resets), because the fire found nothing but output is still expected.
- **Productive reset clears it**: the code-level `recordProductive` (inside `record_activity`) now also clears `pendingAsync` — a productive fire means the loop advanced. If another trigger is still genuinely pending, the worst case is the breaker taking longer to trip: fails open.
- **Window rollover clears everything**: a stuck trigger (a review that never arrives) blocks the breaker for at most one night.

### 4. The sync lift is code-level, inside `upsert_idea`

When `upsert_idea` creates a NEW open unit OR sets `freshInput: true`, the handler resets `consecutiveEmpty` to 0 (leaving `pendingAsync` untouched). A discovery or deep sync that surfaces work thereby un-trips the breaker with no prompt cooperation. Parking writes (`blocked: true` on an existing unit) and closes (`open: false`) do NOT reset.

### 5. Config: `stopAfterEmptyRounds` is an int 0–10, default 2; 0 disables

This resolves the proposal's "min 1 … 0 disables" contradiction: the schema is `z.number().int().min(0).max(10).default(2)`. Added to `idlerConfigSchema`, `IdlerConfig`, `DEFAULT_CONFIG` (value 2 — the breaker is ON by default), and `set_idler_config` (patch-style like its siblings). Handlers read the value live at call time, so an edit applies on the next fire with no reconcile: the knob feeds tool behavior, not prompt content.

## Risks / Trade-offs

- [False trip on a quiet-then-busy night] → the lift is automatic: the next sync fire that surfaces a unit resets the counter in code; bounded by one sync interval. Default threshold 2 means two full empty fires before any trip.
- [Claude ignores the tripped flag] → the fire runs the normal cheap-first empty path; fails open at the old empty-fire price.
- [Threshold edited mid-night] → handlers read live config; a lowered threshold can trip immediately, a raised one un-trips. Admin-visible and intentional.
- [Stuck `asyncKey` never cleared] → window rollover clears nightly; cost is one breaker-less night, the pre-feature status quo.

## Migration Plan

None. The change extends semantics over the `breaker.json` shape cheap-first already ships (`pendingAsync` exists, always `[]`). Disable = `set_idler_config { stopAfterEmptyRounds: 0 }`; rollback = revert, the state file stays valid either way.

## Open Questions

None.
