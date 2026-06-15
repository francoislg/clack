## Context

A change session is bound 1:1:1 to one branch, one worktree, and one PR. `ActiveChangeState.branch` is set once in `startChangeWorkflow` (`src/changes/workflow.ts:252`) and never mutated; every worker tool reads `ctx.branchName` (`WorkerToolContext`, `src/tools/context.ts:79`). `git_push` and `ensure_pr` are hardcoded to that branch, so a worker that decides a slice of its work belongs in its own PR has no sanctioned path.

Relevant existing seams:
- **Intent staging already exists in query mode.** Action tools (`propose_change`, `request_update`) call `intentStore.stage(intent)` and the orchestrator drains them after the run via `getStagedIntents()` (`src/tools/server.ts:712`). Worker mode has **no** IntentStore today — worker tools invoke side effects directly.
- **`executeChange()` returns `ExecutionResult`** (`src/changes/execution.ts:479`, type at `src/changes/types.ts:149`) — the natural carrier for staged spinoffs back to the orchestrator.
- **`startChangeWorkflow(request, plan, sessionId, onEvent, deps, onAck)`** (`src/changes/workflow.ts:216`) is the single entry that creates `ActiveChangeState`, acquires a worker, and runs execution. Calling it again is how a sibling is born.
- **A change session's Slack thread** comes from the session's `threadTs`/`channelId`; the initial top-level message is the originating query/trigger message. A sibling needs its OWN top-level message → its own session → its own thread.
- **Backpressure:** per-user cap `changesWorkflow.maxActiveChangesPerUser` (default 1) counts only `executing`/`reviewing`/`merging`; pool `maxConcurrent`/`maxQueueDepth` are per-repo, `PoolExhausted` thrown past the queue bound (`src/workers/reusablePool.ts:204`).

## Goals / Non-Goals

**Goals:**
- A worker can stage a spinoff intent for a slice of its current changes (files/paths + description + proposed branch type/name), mid-implementation or mid-review.
- The orchestrator provisions a standalone sibling change session per intent: fresh branch, own `pool.acquire()`, own top-level Slack thread, own follow-up lifecycle (review/update/merge/close).
- The actual code of the slice moves to the sibling — not a lossy re-implementation — and is removed from the originating worktree so the parent PR no longer contains it.
- The 1:1:1 invariant is preserved: spinoff yields N independent sessions; no session's branch is ever mutated.
- Zero behavior change when no spinoff is staged.

**Non-Goals:**
- No lifecycle coupling between parent and sibling (merging/closing one does nothing to the other). Optional traceability linkage only.
- No auto-merge of siblings; they follow the normal review→merge path.
- No cross-repo spinoff — sibling lives in the same repo as the parent.
- No nested spinoff depth limit logic beyond the existing pool/queue bounds (a sibling may itself spin off; same machinery applies).

## Decisions

### D1 — Worker stages an intent; the orchestrator provisions. The worker never calls `pool.acquire()` or `startChangeWorkflow`.
Mirror the query-mode IntentStore pattern on the worker side: `buildWorkerTools` creates a fresh `IntentStore` per build (exactly as `buildQueryTools` does), passes it to the new `propose_spinoff` tool factory, and exposes it via the worker result's `getStagedIntents()`. The store is **not** a field on `WorkerToolContext` — query mode keeps it local to the tool-server build, and the worker side matches that so the context type carries no mutable staging state. After the run, `executeChange()` drains staged spinoffs into `ExecutionResult.stagedSpinoffs`.

The drained slices then ride out on `ChangeResult.spinoffs` rather than being provisioned inside `workflow.ts`: provisioning a sibling needs a Slack client, `createSession`, a streamer, and permalink calls — none of which `workflow.ts` has (it is Slack-agnostic, driven only by `onEvent`/`onAck`). So `workflow.ts` **surfaces** the slices and the **handler layer** (`changeAction.ts` → `spinoffSiblings.ts`, which owns the client/session/streamer machinery) provisions them.

*Why over alternatives:* a worker that directly acquired a second worker while still holding its own slot can deadlock the pool (waits for a slot only freed when it finishes, but it won't finish until the spawn does), and would create change sessions from two places. Staging keeps session lifecycle, thread mapping, and pool accounting in the one place that already owns them — the same reason query mode stages rather than acts.

### D2 — Provision siblings AFTER the parent run fully returns; no slot-release dependency.
The handler provisions siblings only once `startChangeWorkflow`/`handleFollowUp` has fully returned for the parent. There is **no deadlock risk and no need to release the parent's slot first**: the parent run is already complete and is not awaiting the sibling, so each sibling's `pool.acquire()` simply queues behind whatever is busy and runs when a slot frees (`PoolExhausted` past `maxQueueDepth` fails that one sibling gracefully). Note the parent does *not* release its pool slot at `pr_created` — it holds it for follow-ups — but because provisioning is strictly after-return, that is irrelevant to liveness. Siblings are provisioned sequentially for deterministic ordering and predictable pool pressure.

*Why:* the original "release the slot first" framing assumed a deadlock that cannot occur once provisioning is after-return. Sequential, after-return dispatch is inherently safe.

### D3 — The slice travels as a git patch on disk, not a re-implementation.
On `propose_spinoff`, the worker (driven by tool logic, not Claude prose) produces `git diff` restricted to the intent's paths, writes it to a temp patch under `data/` (host-shared filesystem, reachable by both worktrees), and reverts those paths in its own worktree (`git checkout -- <paths>` for tracked, remove for new files). The intent carries the patch location + path list. The sibling worker session applies the patch on its fresh branch before its normal commit/push/PR flow.

*Why over re-implementation:* "spin off a slice of its **changes**" means the literal diff, not a paraphrase Claude regenerates (lossy, risks drift). Patch-on-disk avoids stuffing large diffs through the intent envelope and works because all worktrees share one host filesystem under `data/worktrees`.

*Why revert-in-parent at stage time:* guarantees the slice lands in exactly one PR. If staging succeeds but sibling provisioning later fails, the orchestrator reports failure in the sibling's thread and the patch file is retained for manual recovery — the parent has already cleanly shed the slice.

### D4 — Sibling gets a NEW top-level Slack message → new session → new thread.
Before calling `startChangeWorkflow` for a sibling, the orchestrator posts a fresh top-level `chat.postMessage` (no `thread_ts`) in the originating channel, creates a new session bound to that message's ts, and starts the change there. A short cross-link line is posted in the parent thread ("Spun off `<slice>` → <link to sibling thread>") and in the sibling thread ("Spun off from <link to parent thread>").

*Why:* the user asked for standalone threads, not threaded children — each PR gets an independent conversation space for its own review/update/merge follow-ups, which the existing follow-up router already keys by thread.

### D5 — Orchestrator-initiated siblings bypass the per-user active-change cap, but honor pool capacity.
The per-user cap (`maxActiveChangesPerUser`) gates *user-initiated* new requests. A spinoff is a continuation of already-approved work, so sibling provisioning passes `bypassUserCap: true` to `startChangeWorkflow` (skipping that check) but still goes through `pool.acquire()` (subject to `maxConcurrent`/`maxQueueDepth`). If the pool rejects with `PoolExhausted`, `startChangeWorkflow` already turns it into a graceful failure result that the sibling's streamer finalizer posts in the sibling's own thread; the parent and other siblings are unaffected.

*Why:* honoring the default cap of 1 would block every spinoff outright (the parent already consumed the budget at request time). Pool capacity is the real backpressure and remains enforced.

### D6 — Branch-name collision handling.
The worker proposes a branch name in the intent (validated against the existing `clack/{type}/{name}` pattern). The orchestrator checks it against live worktrees/branches and, on collision, appends a short disambiguating suffix before provisioning.

## Risks / Trade-offs

- **Patch fails to apply cleanly on the sibling branch** (parent worktree had drifted from default base) → sibling branches off the same default base the parent did; `git apply` failure is caught, reported in the sibling thread, patch retained. Parent PR already shed the slice, so worst case is a recoverable orphaned patch, never silent data loss.
- **Orphaned top-level message if provisioning fails after posting** → the same message becomes the failure-report thread; no dangling empty threads.
- **Pool exhaustion under many simultaneous spinoffs** → sequential dispatch + `PoolExhausted` graceful per-sibling failure; no deadlock because siblings are provisioned strictly after the parent run returns (D2), not while it is held.
- **Reverting new (untracked) files in the parent** must delete them, not `git checkout` → tool logic distinguishes tracked vs. new paths from `git status` before reverting.
- **Worker confusion over when to spin off** → worker-mode instruction gives explicit triggers (unrelated refactor surfaced; reviewer asked to split) and forbids spinning off the whole change (that's just the current PR).

## Migration Plan

Additive. No data migration. Absent a `propose_spinoff` call, `ExecutionResult.stagedSpinoffs` is empty/undefined and the orchestrator's new dispatch step is a no-op — behavior is byte-identical to today. Rollback = remove the tool registration; staged-spinoff field is optional and ignored if unread.

## Open Questions

- Should the parent thread's PR description/summary auto-note which slices were spun off (for reviewer context), or is the cross-link line enough?
- Cap on spinoffs per single worker run (defensive bound), or rely entirely on pool/queue limits?
- Persist parent↔sibling linkage in session state for later traceability, or keep it ephemeral (just the Slack cross-link)?
