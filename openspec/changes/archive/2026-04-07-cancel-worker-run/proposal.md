## Why

There is no way to cancel a running worker execution (change workflow). Once a worker starts executing, reviewing, or merging, users must wait for it to finish or time out. This wastes compute when the user realizes they made a mistake, wants to change direction, or a worker is stuck. Query-mode already supports cancellation via message editing, but worker-mode has no equivalent.

## What Changes

- Add a `cancel_worker_run` MCP tool (query-mode, action tool) that aborts in-flight worker executions
- Add `"cancelled"` as a new `ChangeStatus` to distinguish user-initiated cancellation from failures
- Thread an `AbortController` through the worker execution pipeline so it can be triggered externally
- Store `cancelledBy` metadata (who cancelled and why) in `ActiveChangeState` and `PersistedSessionState`
- Display cancellation clearly in the Slack thread streamer ("This work session was cancelled by @User"), the Home Tab, and the `find_changes` tool
- Admin/owner users can cancel any user's worker run; dev users can cancel their own

## Capabilities

### New Capabilities
- `worker-cancellation`: Ability to cancel in-flight worker executions via MCP tool, with proper status tracking, permission checks, and user-facing feedback

### Modified Capabilities
- `changes-workflow`: Add `"cancelled"` to `ChangeStatus`, add `cancelledBy` to persisted state, handle cancelled status in restore/display flows
- `clack-tools`: Register `cancel_worker_run` as a query-mode action tool gated by dev+ role and changes workflow enabled

## Impact

- `src/changes/types.ts` — new status in `ChangeStatus` union, `cancelledBy` field on `PersistedSessionState`
- `src/changes/activeState.ts` — `abortController` and `cancelledBy` fields on `ActiveChangeState`
- `src/changes/execution.ts` — accept external `AbortController`, distinguish cancellation from timeout
- `src/changes/workflow.ts` — create/attach/cleanup `AbortController` per execution, detect cancellation and set status
- `src/changes/persistence.ts` — `statusToPhase` for `"cancelled"`, persist `cancelledBy`
- `src/changes/restore.ts` — treat `"cancelled"` as terminal status
- `src/tools/actions/cancelWorkerRun.ts` — new tool file
- `src/tools/server.ts` — register the tool
- `src/slack/homeTab.ts` — emoji for cancelled status
- `src/streaming/slackStreamer.ts` — cancellation-specific finalization in `finalizeStreamedWorkflow`
- `src/slack/handlers/changeAction.ts` and `changeThreadActions.ts` — pass `ChangeResult` cancellation fields to `finalizeStreamedWorkflow`
