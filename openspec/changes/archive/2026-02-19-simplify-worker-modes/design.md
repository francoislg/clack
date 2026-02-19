## Context

The worker tool server uses a `WorkerMode` discriminated union (`"execute" | "update" | "review" | "merge" | "close"`) to gate which MCP tools are available per worker invocation. In practice, the prompt and context already drive Claude's behavior — the mode-based gating only causes bugs (e.g., `ensure_pr` unavailable on update retries) without adding safety. Additionally, follow-up action tools and auto-execute lack role-based permission checks.

## Goals / Non-Goals

**Goals:**
- Collapse 5 worker modes into a single `"worker"` mode with all tools always available
- Gate follow-up action tools on `canRequestChanges(role)` to prevent non-privileged access
- Gate auto-execute on role as defense-in-depth
- Remove `WorkerMode` type and `mode` parameter from context builder

**Non-Goals:**
- Changing the two-phase architecture (query → worker still separate invocations)
- Changing the prompt/instruction system
- Modifying worker tool implementations (they don't reference `ctx.mode`)
- Changing `FollowUpCommand`, `StagedIntentType`, or any Slack-facing interfaces

## Decisions

### Decision 1: Single worker mode with all tools

**Choice**: Remove the 5-case switch and always register all worker tools (git_push, ensure_pr, merge_pr, close_pr, report_status).

**Rationale**: Worker tool implementations don't reference `ctx.mode`. The prompt already tells Claude what to do (e.g., "merge the PR" → Claude calls merge_pr). Having extra tools available is harmless — Claude won't call merge_pr during an execute flow because the prompt doesn't ask for it. The upside is eliminating a class of bugs where tools are unexpectedly unavailable.

**Alternative considered**: Keep mode-based gating but fix the specific bugs. Rejected because it perpetuates complexity for no safety benefit.

### Decision 2: Permission check on follow-up action tools

**Choice**: Add `canRequestChanges(ctx.role)` check alongside the existing `ctx.changeSession` check at `server.ts:157`.

**Rationale**: Currently any user in a change thread gets follow-up tools (request_review, request_merge, etc.) regardless of role. Only dev/admin/owner should be able to trigger change workflows.

### Decision 3: Permission check on auto-execute (defense-in-depth)

**Choice**: Add role check in `handleAutoExecuteActions` that early-returns if user can't request changes.

**Rationale**: If step 2 works correctly, non-privileged users can never produce auto-execute actions (they don't have the tools). But defense-in-depth protects against edge cases like session reconstruction or future bugs.

### Decision 4: Hardcode `mode: "worker"` in context builder

**Choice**: Remove `mode` from `BuildWorkerContextParams` and hardcode `"worker"` in the return value.

**Rationale**: With only one worker mode, the parameter is meaningless. Callers no longer need to decide which mode to pass.

## Risks / Trade-offs

- [Risk] A worker invocation now has tools it shouldn't call (e.g., merge_pr during execute) → **Mitigation**: Prompt drives behavior; Claude won't call merge_pr unless instructed. This is already how query mode works (tools available but unused unless relevant).
- [Risk] Missed references to `WorkerMode` → **Mitigation**: `npx tsc --noEmit` catches all type errors after removal.
