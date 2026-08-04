## Context

Clack runs as a single long-lived Node process in a Docker container on GCE (`--restart unless-stopped`). Deploys swap the container: `docker stop` (SIGTERM → 10s grace → SIGKILL) then `docker run` the new image.

Current shutdown (`src/index.ts`) is not graceful:

```
SIGINT/SIGTERM → stopAll() → statusServer.close() → stopSlackApp() → exit(0)
```

Any in-flight Claude run dies mid-execution. Two run classes exist, both already tracked:

- **Query runs** — `processMessage()` in `core.ts`; registered in `activeRuns` (`src/slack/activeRuns.ts`). Each exposes a `ClaudeRunHandle` with `futureResponse: Promise<ClaudeResponse>` and `stop(reason)`.
- **Worker/tester runs** — `executeChange()` in `changes/execution.ts`; tracked in `activeState` (`src/changes/activeState.ts`), surfaced by the status endpoint's `workers.active`.

The union of the two is the `busy` boolean already served at `GET /status`. The deploy leans on it: `gce-update-image.sh` Phase 1.5 polls `/status` via `docker exec` for up to `DRAIN_MAX_WAIT` (300s) waiting for `busy=false`, then hard-stops. This external drain is structurally weak — the Slack socket stays live during the wait, so new triggers keep starting runs and resetting the count; and it can only *observe*, never *refuse*.

Every run funnels through three creation choke points:

```
processMessage()   ← DM, @mention, auto-respond, newQuery, investigations, cron-query
executeChange()    ← every worker/change + tester run
cron executeJob    ← scheduled fires (cronScheduler.ts)
```

## Goals / Non-Goals

**Goals:**
- On SIGTERM, stop starting new runs and let every in-flight run finish before exiting.
- Bound the wait so a wedged run cannot hold a deploy open forever.
- Make drain progress observable so the deploy (and operators) can see "finishing N runs."
- Reduce the deploy to `docker stop -t <budget>` — delegate draining to the process.
- Zero behavior change during normal operation.

**Non-Goals:**
- Persisting/resuming *query* runs across restart (they're short; a straggler past budget is simply cancelled — the user re-asks). Worker/tester runs already persist and resume via the existing restart/monitor path.
- Draining on soft restart (`restartAll` keeps the socket up and is unaffected).
- Waiting for a *human* to stop chatting. "Finish its conversations" means finish in-flight runs; new turns during quiesce are refused, not awaited.
- Changing the status endpoint's auth, binding, or existing fields.

## Decisions

### 1. A single quiescing flag behind a small shutdown module

Add `src/shutdown.ts` owning module-level `quiescing` state (`isQuiescing()` / `beginQuiesce()`) and the `drainAndExit()` orchestration. One flag, checked at the three choke points — not a flag per trigger. This keeps the quiesce surface at 3 edits, matching where runs are actually born.

*Alternative considered:* gate inside each Slack handler (DM/mention/autoRespond/…). Rejected — ~7 interactive handlers plus cron plus investigations all already converge on `processMessage`; gating downstream is fewer touch-points and cannot be bypassed by a new trigger added later.

### 2. Gate at run-creation entry, before registration

Each choke point checks `isQuiescing()` at the top and returns early *before* registering a run:
- `processMessage` → post an ephemeral "restarting, back shortly" (`t()`-localized) for interactive triggers; for cron-origin query runs, just skip.
- `executeChange` → return a rejected `ExecutionResult` (the change stays staged; the button re-engages after reboot).
- cron `executeJob` → skip the fire (cron catch-up backfills it on reboot).

This guarantees the drain set only shrinks — nothing new enters `activeRuns` / `activeState` once quiescing begins.

### 3. Drain = await the registered handles, polled against `busy`

`drainAndExit()`:
1. `beginQuiesce()`.
2. Loop: read the same `busy` union the status endpoint uses (active-runs snapshot + running-changes snapshot). While `busy` and within budget, `await Promise.race([Promise.allSettled(handles.map(h => h.futureResponse)), timeout])` — re-derive the handle set each iteration so runs that settle drop out and none that started before the gate are missed.
3. On drained → proceed to teardown. On budget elapsed → `stop("shutting down")` every remaining handle, log the cancelled set, proceed to teardown.
4. Teardown = the existing `stopAll()` → `statusServer.close()` → `stopSlackApp()` → `exit(0)`.

Reuse the existing `activeRuns.snapshot()` and `snapshotRunningChanges()` so drain and `/status` agree by construction. `activeState` needs a way to enumerate the *executing* run handles for `stop()`; `worker-cancellation` plumbing already stops worker runs, so wire drain to that rather than inventing a second path.

### 4. Second signal forces exit

First SIGTERM/SIGINT → `drainAndExit()`. A second one while draining → `exit(1)` immediately (operator override for a wedged drain). Guard with an "already draining" flag so repeated signals during a normal drain don't stack.

### 5. Budget reuses the deploy's `DRAIN_MAX_WAIT` convention

Grace budget from env/config, default 300s — the same number the external poll used, so deploy timing is unchanged. `docker stop -t` must be set ≥ budget so Docker doesn't SIGKILL mid-drain; the deploy sets `-t $((DRAIN_MAX_WAIT + slack))`.

### 6. Status gains a `state` field, existing fields untouched

`GET /status` adds `state: "running" | "draining"`. `busy`/`activeRuns`/`workers` keep their exact meaning. The deploy and Home Tab can distinguish "busy but healthy" from "busy and shutting down." Additive — old consumers ignore the new field.

### 7. Deploy delegates draining to `docker stop -t`

Drop `gce-update-image.sh` Phase 1.5's poll loop; replace the swap's `docker stop clack` with `docker stop -t <budget> clack`, which sends SIGTERM and waits up to `<budget>` for the process to exit. The `/deploy` skill's Monitor filter switches from the old drain markers to the process-side drain log lines. Downtime accounting is unchanged (drain still precedes the swap; it's just inside the container now).

## Risks / Trade-offs

- **`--restart unless-stopped` resurrects a bare-signal exit** → The drain-then-`exit(0)` contract is intended to be driven by `docker stop`, which marks the container explicitly stopped (no restart). A human `docker exec … kill -TERM 1` would drain then get bounced by Docker. Documented as an operational note; the deploy path is unaffected.
- **A wedged worker/tester run holds the deploy for the full budget** → Bounded by the grace budget, after which stragglers are `stop()`-ed and the process exits. Worker/tester runs persist and resume post-reboot, so a cancelled straggler isn't lost.
- **New work refused during the drain window** → Interactive users get an ephemeral notice; cron self-heals via catch-up. The window is only as long as it takes in-flight runs to finish (typically seconds for query-only lulls).
- **Drain loop must not miss a run that started just before the gate** → Re-derive the handle set each iteration from the live snapshots rather than snapshotting once; the gate closes new entries, so the set is monotonically non-increasing and convergence is guaranteed.
- **Double-signal race** → An "already draining" latch makes the first signal own the drain and a second force-exit; `drainAndExit()` is idempotent on re-entry.

## Migration Plan

1. Ship `src/shutdown.ts` + the three quiesce gates + status `state` field + the rewired `index.ts` handler. Fully backward-compatible at runtime (nothing quiesces until a signal arrives).
2. Deploy the new image with the *current* external-poll script (still works — new image drains itself on the old script's `docker stop`, poll just sees `busy=false` fast or times out harmlessly).
3. Then update `gce-update-image.sh` to `docker stop -t <budget>` and the `/deploy` skill markers. Order matters: the image must understand SIGTERM-drain before the script stops polling.

**Rollback:** revert `index.ts` to the immediate-teardown handler; the external poll in the (reverted) deploy script continues to function. The status `state` field is additive and harmless if left.

## Open Questions

- Should query stragglers past budget get a courtesy "cancelled for a deploy" message in-thread, or exit silently? (Leaning silent — the run's `stop()` already yields a `cancelled` response the delivery layer may surface.)
- Should the Home Tab render `state: "draining"` (e.g. a "restarting…" banner), or is that out of scope for this change? (Leaning out of scope; the field is there if wanted later.)
