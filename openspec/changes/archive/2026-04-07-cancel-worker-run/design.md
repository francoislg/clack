## Context

Worker executions (change workflow) use the Agent SDK which accepts an `AbortController` for cancellation. Currently, `runClaude()` creates its own controller internally, used only for timeout. No external code can trigger the abort.

Query-mode already has cancellation via an in-flight request registry (`src/slack/inFlightRequests.ts`), but that pattern is event-driven (message edits) and keyed by channel+messageTs — not transferable to worker runs which are keyed by sessionId.

Active worker state is tracked in-memory by `activeChanges` (Map in `activeState.ts`) and persisted to `data/worktree-sessions/{branch}/state.json`. The Home Tab and `find_changes` tool both read from `getActiveWorkers()`.

## Goals / Non-Goals

**Goals:**
- Users can cancel their own running worker executions via natural language ("cancel my worker run")
- Admins/owners can cancel any user's worker run
- Cancelled runs are visually distinct from failures in Slack threads, Home Tab, and `find_changes`
- Cancellation metadata (`cancelledBy`) survives restarts via `PersistedSessionState`
- After a restart, stale sessions without a live process can still be marked as cancelled

**Non-Goals:**
- Slack button on the streamer message (Option B from exploration — viable future enhancement but adds complexity to SlackStreamer)
- Keyword detection in change threads (Option C — could layer on later)
- Cancelling worktree setup (runs before the main execution, short-lived)

## Decisions

### 1. AbortController on ActiveChangeState (not a separate registry)

Store `abortController?: AbortController` directly on `ActiveChangeState`. This is runtime-only state that's already stripped before persistence.

**Why not a separate registry?** `ActiveChangeState` already tracks runtime worker state (status, sdkSessionId, worktree). Adding the controller there avoids a parallel data structure and keeps the lookup path simple: `getActiveChangeForUser()` → `change.abortController?.abort()`.

### 2. Accept external AbortController in runClaude

`runClaude()` accepts an optional `abortController` parameter. If provided, uses it; otherwise creates one internally. The timeout is set on whichever controller is in use. A `timedOut` flag distinguishes timeout aborts from user-initiated cancellation.

**Why not AbortSignal.any()?** Requires Node 20+. The project targets Node 18+.

### 3. cancelledBy on ActiveChangeState, flowed through ChangeResult

The cancel tool sets `change.cancelledBy = { userId, reason? }` before calling `abort()`. After execution returns, `workflow.ts` checks `activeChange.cancelledBy`:
- If set → status = `"cancelled"`, return `{ success: false, cancelled: true, cancelledBy }`
- If not set → status = `"failed"` (timeout, error, etc.)

This flows up to `changeAction.ts` / `changeThreadActions.ts` which format the streamer message.

### 4. "cancelled" as a distinct ChangeStatus

Add `"cancelled"` to the `ChangeStatus` union. It's terminal (like `"completed"` and `"failed"`).

**Why not reuse "failed"?** A cancellation is intentional — the user chose to stop. A failure is unexpected. They have different display (emoji, wording), different semantics in `find_changes`, and potentially different behavior (a cancelled session might be re-requestable differently than a failed one).

**Downstream touches:**
- `statusToPhase("cancelled")` → `"Cancelled"`
- `restore.ts` — add to terminal statuses (skip on restore)
- `getActiveChangeForUser` — already excludes non-active statuses, no change needed
- `find_changes` — add `"cancelled"` to the status enum
- `homeTab.ts` — add emoji (`:no_entry_sign:`)

### 5. Permission model: own + admin escalation

The tool accepts an optional `target_user_id` parameter:
- If omitted → cancel the caller's own active run (`getActiveChangeForUser(ctx.userId)`)
- If provided → require admin/owner role, then look up that user's active run

This is consistent with the existing role model where admin+ can manage other users' state.

### 6. Streamer finalization for cancellation

`ChangeResult` gains `cancelled?: boolean` and `cancelledBy?: { userId: string; reason?: string }`. The handlers that call `finalizeStreamedWorkflow` check for `cancelled` and format:

> "This work session was cancelled by <@U123>"

or with reason:

> "This work session was cancelled by <@U123>: taking too long"

### 7. Persisting cancelledBy

`PersistedSessionState` gains `cancelledBy?: { userId: string; reason?: string }`. Written when status transitions to `"cancelled"`. This means `execution.log` and `state.json` both record who cancelled and why.

## Risks / Trade-offs

**[Race condition: cancel during status transition]** → The abort fires while the worker is between tool calls. The SDK handles this gracefully (throws on next iteration). The `finally` block in `workflow.ts` cleans up the controller.

**[Cancel during follow-up vs initial execution]** → Both `startChangeWorkflow` and `handleFollowUp` create and attach controllers. After cancellation in a follow-up, the status reverts to `"cancelled"` rather than `"pr_created"`. The PR still exists on GitHub — the user can re-request review/update/merge later. This is acceptable: the cancel stops the compute, not the PR.

**[Post-restart stale sessions]** → `restoreWorkerSessions` already handles mid-execution sessions on startup (downgrades to `pr_created` or marks `failed`). The cancel tool handles the edge case where a session is restored as active but has no live controller — it reports that the process is gone and the session will be cleaned up.
