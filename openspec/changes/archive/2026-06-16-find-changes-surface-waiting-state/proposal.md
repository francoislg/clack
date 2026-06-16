## Why

When a user asks Clack "what's the progress on my change?", `find_changes` reports the change's `status` (`executing`, `reviewing`, …) but cannot say whether the change is actually *running* or *parked waiting for execution capacity*. In reusable-pool mode a request can sit in the pool queue with no Claude work happening, yet `find_changes` shows nothing distinguishing it from an actively-running change. The pool already signals this via the abstract `onQueued` seam (`WorkerPool.acquire`), but the signal is only logged and Slack-acked — it is never recorded where `find_changes` can read it.

## What Changes

- Record a **mode-neutral waiting marker** on the active-change runtime state when the pool enqueues an acquire (driven by the existing `onQueued` callback), and clear it the moment a worker is handed out.
- Surface that marker on `find_changes` as a derived boolean `waiting` (true while parked, otherwise absent/false), plus a freshness signal (`lastActivityAt` and a derived `ageMs`) so "is it actually progressing?" is answerable.
- Keep the tool **pool-agnostic**: `find_changes` reads only active-change state, never the pool. The disposable pool never fires `onQueued`, so `waiting` is simply never set — the abstraction degenerates instead of branching. Pool-implementation nouns (queue depth, slot ids, quarantine, setup hashes) are deliberately **excluded** from `find_changes`; they remain Home-Tab/ops concerns.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `changes-workflow`: the active-change state tracking records a neutral `waiting` marker via the existing `onQueued` seam (set on enqueue, cleared on worker acquisition) and exposes `lastActivityAt` on the active-change snapshot.
- `clack-tools`: the `find_changes` tool output gains a derived `waiting` flag and freshness fields (`lastActivityAt`, `ageMs`).

## Impact

- `src/changes/activeState.ts` — `ActiveWorker` gains `waiting` + `lastActivityAt`; new setter to mark/clear waiting; `getActiveWorkers` projects the new fields.
- `src/changes/workflow.ts` — the existing `onQueued` handler also records the waiting marker; the post-`acquire` path clears it.
- `src/tools/query/findChanges.ts` — projects `waiting`, `lastActivityAt`, `ageMs` into the tool result.
- No changes to `src/workers/*` (the `onQueued` seam already exists); disposable-pool behavior is unchanged.
