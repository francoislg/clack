## Why

A change session is bound 1:1:1 to one branch, one worktree, and one PR — the binding is set once at session start (`ActiveChangeState.branch`) and is immutable for the session's life. When Claude, mid-implementation or mid-review, realizes a slice of the work belongs in its own PR (e.g. an unrelated refactor surfaced while addressing review, or a reviewer explicitly asks to split), it has no sanctioned path: `git_push`/`ensure_pr` are hardcoded to the session branch, and there is no tool to open a second PR. The work dead-ends or gets crammed into the wrong PR.

## What Changes

- Add a worker tool (`propose_spinoff`) that lets the worker **stage an intent** to carve a slice of its current changes into a separate PR. The worker does NOT create the PR or acquire a second worker itself — it describes the slice (files/paths/summary + proposed branch name + spinoff description) and returns.
- The orchestrator (`changes/workflow.ts`) reads the staged spinoff intent when the worker returns and provisions a **standalone sibling change session**: a fresh `ActiveChangeState` on a new branch, its own `pool.acquire()`, and its **own Slack thread** (a new top-level message, NOT a threaded child of the originating thread).
- The sibling session is independently manageable: review / update / merge / close follow-ups operate in its own thread via the existing follow-up machinery, with no lifecycle coupling back to the parent session.
- The originating session continues unaffected — its branch/PR keep only the non-spun-off changes.
- Preserve the **1 session : 1 branch : 1 PR** invariant throughout: spinoff produces N sessions, never mutates an existing session's branch.

## Capabilities

### New Capabilities
- `pr-spinoff`: A worker can stage a spinoff intent for a slice of its changes; the orchestrator provisions a standalone sibling change session (new branch, new worker, new Slack thread) that owns its own PR and follow-up lifecycle.

### Modified Capabilities
<!-- No existing OpenSpec capability spec covers the worker tool surface or change-session lifecycle as requirements; introducing as a new capability. -->

## Impact

- **New worker tool:** `src/tools/worker/proposeSpinoff.ts` + registration in `src/tools/server.ts` (worker toolset) and gating in the worker MCP assembly.
- **Worker result envelope:** the worker→orchestrator return path must carry staged spinoff intents (analogous to how query-mode action tools stage intents). Touches `src/tools/worker/` context/result types and `src/changes/execution.ts` (`executeChange` return).
- **Orchestration:** `src/changes/workflow.ts` gains a post-execution step that consumes spinoff intents and calls the existing change-start path to provision sibling sessions (new branch, `pool.acquire()`, new thread). Must respect per-user active-change caps and pool capacity (`maxConcurrent`/`maxQueueDepth`) without deadlocking the parent's held slot.
- **Slack surface:** a new top-level message/thread is posted for each sibling session; new direct-to-Slack strings go through `t()` (EN + FR parity).
- **State:** sibling sessions persist as ordinary change sessions; optional lightweight parent↔sibling linkage for traceability (no lifecycle coupling).
- **Worker prompt/instructions:** worker-mode guidance describing when and how to use `propose_spinoff`.
- **No breaking changes:** absent any spinoff intent, behavior is identical to today.
