## Why

The worker tool server currently has 5 modes (`execute`, `update`, `review`, `merge`, `close`) that gate which MCP tools are available. This causes bugs — e.g., `ensure_pr` is unavailable on retry because the mode doesn't include it — and adds unnecessary complexity. The actual behavior differences between worker invocations come from the **prompt and context**, not the tool set. Additionally, follow-up action tools and auto-execute lack permission checks, allowing non-privileged users theoretical access to change workflows.

## What Changes

- Remove `WorkerMode` type and the 5-case switch in `buildWorkerTools`; replace with a single `"worker"` mode that always registers all worker tools (git_push, ensure_pr, merge_pr, close_pr, report_status)
- Gate follow-up action tools (`request_review`, `request_merge`, `request_update`, `request_close`) on `canRequestChanges(role)` in addition to the existing `changeSession` check
- Gate auto-execute in `handleAutoExecuteActions` on user role as defense-in-depth
- Remove `mode` parameter from `buildWorkerContext` and all call sites

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `clack-tools`: Remove per-mode worker tool gating; worker mode always gets all tools. Gate follow-up action tools on permissions.
- `auto-execute-actions`: Add requirement that auto-execute only fires for privileged users (dev/admin/owner).
- `worker-tools`: Remove mode-specific tool registration; all worker tools always available.

## Impact

- `src/tools/types.ts` — remove `WorkerMode` type
- `src/tools/context.ts` — remove `mode` from `BuildWorkerContextParams`, hardcode `"worker"`
- `src/tools/server.ts` — replace switch with unconditional tool registration; add permission check on follow-up tools
- `src/changes/execution.ts` — remove `mode: "execute"` from `buildWorkerContext` call
- `src/changes/workflow.ts` — remove mode ternary from `buildWorkerContext` call
- `src/slack/handlers/core.ts` — add permission check to `handleAutoExecuteActions`
