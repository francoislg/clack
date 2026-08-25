## Context

In one measured night, most fires were empty. The work fire currently walks the full step ladder and may attach the GitHub MCP before discovering nothing is fresh. Facts that constrain the design:

- **Cron prompts are static** — built at `reconcile()` time in `src/plugins/idler/index.ts` and persisted on the job. Per-fire state cannot be embedded in the prompt; it must flow through a tool result.
- **The ledger lives on core memory entries** (`plugins.idler` slot, `src/plugins/idler/slice.ts`). `list_top_ideas` / `upsert_idea` / `record_activity` are always-on default-server tools, reachable with no `attach_integration`.
- **The work spec is channel'd with `submitResponseMode: "optional"`** — ending a fire without a delivered message is already representable.
- **The activity log cannot carry cross-fire state** — the summary fire clears it via `clear_activity`.
- **The sync tiers (light / discovery / deep) prime the ledger** — freshness state (`freshInput`, `blocked`, priority, cursors) is maintained there, so the work fire can trust it.

## Goals / Non-Goals

**Goals:**

- An empty work fire ends in ~3 cheap turns: `list_top_ideas` → `record_fire_outcome` → skip. No MCP attach, no source sweep.
- A machine-readable empty/productive record (`data/plugins/idler/breaker.json`) that survives across fires and nights, independent of the activity log.
- A file shape that is forward-stable for `idler-night-circuit-breaker` (no migration when that change lands).

**Non-Goals:**

- No trip / early-exit semantics — that is `idler-night-circuit-breaker`.
- No per-server attach narrowing — that is `idler-narrow-mcp-attach`.
- No core/SDK changes, no cron layout changes.

## Decisions

### 1. Empty increments are Claude-called; productive resets are code-level

The signal has two halves with different reliability needs:

- **Empty** — only Claude knows a fire ended empty. A new always-on tool `record_fire_outcome({ outcome: "empty" })` records it. If Claude forgets the call, the counter under-counts and the future breaker fails **open** — a cost regression, never a false stop. That safe failure direction is what makes a prompt-driven increment acceptable.
- **Productive** — piggybacked in code on the `record_activity` handler: every kind except `parked` resets `consecutiveEmpty` to 0. `parked` is bookkeeping for a stale unit — the fire found nothing fresh, so it must not reset (the fire's own `record_fire_outcome` call still records the emptiness). `failure` DOES reset: a failed implement attempt proves fresh work exists; the breaker must not trip while a unit is retrying.

Alternatives rejected: inferring the outcome inside `list_top_ideas` (the tool cannot know what the fire did after the read); a per-session end-of-fire hook (no such SDK surface, and adding one violates the no-core-changes scope).

### 2. `breaker.json` — graceful zod, forward-stable shape

A new module `src/plugins/idler/breaker.ts` owns the file (via `sdk.readFile`/`sdk.writeFile`, path `breaker.json`):

```ts
{ windowKey: string, consecutiveEmpty: number /* int ≥ 0, default 0 */, pendingAsync: string[] /* default [] */ }
```

Graceful reader per project convention: absent or invalid file → `{ windowKey: "", consecutiveEmpty: 0, pendingAsync: [] }`, never a throw. `pendingAsync` is written (always `[]`) but not consumed by this change — it is declared now so the circuit-breaker change never migrates the file shape.

### 3. `windowKey` = the date the current work window opened

`windowKeyFor(window, now)`: YYYY-MM-DD rendered in `workHours.tz`. For an overnight window (`start > end`), hours before `end` belong to the PREVIOUS calendar day's key — a 2 AM fire in an 18→9 window keys to yesterday. Recording an empty fire first compares stored vs current key; a mismatch resets state to `{ windowKey: current, consecutiveEmpty: 1, pendingAsync: [] }` — rollover IS the first increment. The helper lives in `breaker.ts` beside the schema (`heuristic.ts` stays pure cron math).

### 4. Freshness from the ledger; verify only the selected unit; park-and-end

The restructured work prompt makes `list_top_ideas` step 1 (always-on, no attach). Freshness is judged from the LEDGER (priority / `freshInput` / `blocked` / cursors) that the sync tiers primed — the work fire never sweeps sources or probes PRs to *find* work. Reference re-reads (including the canonical PR review check, which needs the GitHub attach) happen only AFTER a single unit is selected. If the re-read reveals the ledger was stale — no fresh work after all — the fire parks that unit (`upsert_idea` `blocked: true`), records the empty outcome, and ENDS. It does not cascade to the next unit with another deep read; the next fire sees the parked unit sunk and picks the next-best. Each fire pays for at most one deep read.

Alternative rejected: trying the next unit in the same fire — unbounded worst case (N deep reads and attaches in one fire), exactly the cost shape this change removes.

### 5. The empty path is an explicit prompt step; `requiredTools` stays unset

`buildWorkPrompt` steps become: (1) `list_top_ideas`; (2) if no unit is fresh per the ledger → `record_fire_outcome({ outcome: "empty" })` → end via skip; (3+) otherwise select, re-read, attach lazily, act, `record_activity`. The behavior topic gains matching cheap-first / lazy-attach / park-and-end rules. `record_fire_outcome` is NOT added to the spec's `requiredTools` — it is conditional (productive fires must not call it), and forcing a conditional tool makes the model fabricate calls (per the `CronJobSpec.requiredTools` contract).

## Risks / Trade-offs

- [Claude skips `record_fire_outcome` on an empty fire] → under-count; the future breaker fails open (cost regression, no false stop). Mitigation: explicit numbered step + topic rule; `work.test.ts` asserts the prompt wording.
- [Ledger staleness parks a workable unit] → the deep sync's coldest-unit re-verification pass un-parks it; bounded by one sync cycle.
- [Two writers to `breaker.json` (outcome tool + activity hook)] → single process, sequential tool calls within a fire; read-modify-write inside each call; last-write-wins is acceptable.
- [Prompt drift silently re-inflates cost] → prompt-content assertions in `work.test.ts` / `instructions.test.ts` keep the step order and skip contract pinned.

## Migration Plan

None. `breaker.json` seeds itself on first write; an absent file reads as zero state. Rollback = revert the code; the file is inert.

## Open Questions

None.
