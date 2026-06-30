## Context

The idler keeps a ledger of work units in core memory; each unit's `plugins.idler` slice carries a numeric `priority` computed at `upsert_idea` time from `kind` + `freshInput` (+bump) + `blocked` (−sink). Two cron fires consume it: the **work** fire calls `list_top_ideas` (priority-descending, capped at a top-N `limit`) and advances the highest unit with fresh work; the **sync** ("concierge") fire does read-only ledger maintenance and is told to "recompute priority for every open unit."

The failure: a stale high-priority unit (failing `implement`, `review` with no new commits, passed `staleAfter` horizon) keeps sorting to the top but is never workable, filling the top-N window and starving workable units below it. The concierge is supposed to sink such units, but `list_top_ideas` and `view_idler_ideas` return no `updatedAt`, no `staleAfter`, and no overdue flag — the LLM literally cannot see staleness, and "recompute every open unit" is a fuzzy whole-ledger sweep it performs unreliably.

## Goals / Non-Goals

**Goals:**
- The concierge can see each unit's staleness and reliably park stale units so the work fire stops getting stuck.
- Reuse existing mechanics (`blocked` sink, `freshInput` resurface); no new scoring primitive, config, or persisted state.
- Keep the concierge's worklist bounded and explicit (LLM-reliable), not an open-ended audit.

**Non-Goals:**
- Rebalancing `kind` weights (`review` vs `implement`) or the `freshInput` boost magnitude — separate, also-valid, deliberately excluded.
- A deterministic code-side decay that mutates effective priority at sort time.
- A `manualPriority` / reprioritize override (the user explicitly does not want a manual override; `reprioritize_idea` is left exactly as-is).
- Any config field, migration, or change to `priority.ts` / `slice.ts` / `config.ts`.

## Decisions

### Concierge tooling over deterministic code decay
A fixed read-time penalty (`effective = base − N when stale`) was considered and rejected: it is blunt (a genuine top priority sinks purely on elapsed time), introduces a second scoring path, and contradicts the wariness that "top priorities must also be updated ASAP." Instead the LLM judges staleness with good visibility and applies the **existing** `blocked` sink. The only genuinely new thing is *visibility*, not a new lever.

### `sort_by: "coldest"` = a least-recently-attended rotation
The concierge's job is to find units that *need a re-look*. `"coldest"` sorts open units by `updatedAt` ascending: the unit gone longest without re-verification comes up first. Every `upsert_idea` already bumps `updatedAt` (`touch: true`), so a re-verified unit drops to the **back** of the coldest queue — the bump is the rotation engine, giving fair round-robin coverage. We deliberately keep `touch: true`; no recompute-semantics change. `sort_by: "priority"` (descending) stays the default and is unchanged for the work fire.

### `overdue` is a server-computed boolean
`staleAfter.date` is the trustworthy staleness signal (LLM-set horizon, not bumped by housekeeping). LLMs are unreliable at date comparison, so `list_top_ideas` computes `overdue = staleAfter?.date != null && staleAfter.date < now` and hands over the boolean alongside the raw `staleAfter` and `updatedAt`. The LLM decides "park or refresh"; it does not do date math.

### Park = the existing `blocked` sink, unit stays open
A parked unit is `upsert_idea`'d with `blocked: true`: priority drops below any workable unit, it leaves the work fire's top-N window, but stays `open`. The sync recompute's existing `freshInput` detection auto-resurfaces it when activity returns. No new "parked" state, no close, no delete.

## Risks / Trade-offs

- **`updatedAt` is not "how long stuck," it's "last time the concierge looked"** → That is exactly what a coverage rotation wants; we never use `updatedAt` to *detect* zombies, only to *order the rotation*. Detection uses `overdue` / `staleAfter` and the LLM's read of `whereWeAre`.
- **A unit with no `staleAfter` set never reads `overdue: true`** → The coldest rotation still surfaces it eventually (by age), and the concierge judges it on `whereWeAre` + lack of fresh activity. The sync prompt already instructs setting `staleAfter` at discovery; this change leans on that without enforcing it.
- **LLM may still skip units** → Mitigated by turning "audit everything" into a bounded "here are the N coldest, decide each" worklist; bounded explicit lists are far more reliable than open-ended sweeps. Full coverage is achieved across successive fires via the rotation, not within one fire.
- **Parking is reversible only via `freshInput`** → Correct by design: a parked unit should come back only when its source shows real new activity, which is exactly what `freshInput` detects.
