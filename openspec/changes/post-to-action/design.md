## Context

The `send_to_thread` action type on `submit_response` lets Claude cross-post content to channels and threads. It was designed with an `auto: true` flag (specced in `auto-execute-actions`), but only the button-click path was implemented. The name is also misleading — it handles both thread replies and top-level channel posts depending on whether `thread_ts` is provided.

The existing infrastructure is solid:
- **Snapshot persistence**: `submit_response` saves each `send_to_thread` action's `content` as a snapshot at delivery time (`submitResponse.ts:156-166`). This freezes the content, ensuring the exact text Claude intended gets posted regardless of when execution happens.
- **Target resolution**: `handleSendToThread` in `dmActions.ts` resolves the target via a fallback chain: explicit params → origin channel → assistant channel → session channel. No `thread_ts` → top-level post.
- **Posting**: `postAnswerToChannel` handles rendering snapshots as Block Kit and posting via `chat.postMessage`.

## Goals / Non-Goals

**Goals:**
- Implement `post_to` (renamed from `send_to_thread`) auto-execution using the existing snapshot and target resolution infrastructure
- Rename `send_to_thread` → `post_to` for clarity (it posts to channels too, not just threads)
- Enable the "in the channel" pattern: `post_to` with `auto: true`, no `thread_ts` → top-level channel post

**Non-Goals:**
- New MCP tool for posting messages (the action system provides sufficient guardrails)
- Changes to the `submit_response` termination contract
- Changes to the snapshot persistence mechanism (it already works)

## Decisions

### 1. Auto-execute `post_to` before the role-gated intent loop

The current `handleAutoExecuteActions` has two early guards: `!response.stagedIntents` and `!canRequestChanges(role)`. `post_to` uses neither — it's snapshot-based, not intent-based, and is a presentation concern available to all roles.

**Decision**: Handle `post_to` auto-execution at the top of `handleAutoExecuteActions`, before both guards. The function becomes:

```
handleAutoExecuteActions:
  ├── early return if !response.response?.actions
  ├── handle post_to auto-execute (all roles, snapshot-based)
  ├── early return if !stagedIntents or !canRequestChanges
  └── existing intent-based auto-execute loop
```

**Alternative considered**: Separate function for `post_to` auto-execute. Rejected — it's still "auto-execute an action", same lifecycle, same error handling. Splitting would duplicate the error-posting pattern.

### 2. Reuse `postAnswerToChannel` and target resolution from `dmActions.ts`

The button handler already has the correct logic for resolving targets and posting snapshots. The auto-execute handler needs the same logic.

**Decision**: Extract `postAnswerToChannel` and the target resolution helpers (`resolveOrigin`) from `dmActions.ts` so they can be imported by `autoExecute.ts`. These are currently private functions — they need to be exported (not re-exported via barrel, per project conventions — `autoExecute.ts` imports directly from `dmActions.ts`).

**Alternative considered**: Duplicate the logic in `autoExecute.ts`. Rejected — the target fallback chain is subtle (explicit → origin → assistant → session) and should live in one place.

### 3. Rename `send_to_thread` → `post_to` via migration

Persisted session data contains the old action type name in `lastResponse.actions` and snapshot references. A boot migration renames these.

**Decision**: New blocking migration that:
- Scans session files in `data/sessions/` and `data/worktree-sessions/`
- Renames `type: "send_to_thread"` → `type: "post_to"` in `lastResponse.actions`
- Button handler accepts both old and new action IDs during transition (regex pattern match)

### 4. Skip auto-execute for DM-only and auto-respond triggers

When `triggerType` is `"directMessages"` (no channel context) or `"autoRespond"` (would be noisy), `post_to` auto-execute is a no-op.

**Decision**: Log a debug message and skip. This aligns with the delivery context instructions which already tell Claude not to use channel-posting actions in these modes. The skip is a safety net, not the primary guardrail.

## Risks / Trade-offs

**[Rename scope]** Renaming `send_to_thread` touches many files (types, schema, blocks, handlers, instructions, tests, prompts). → Mitigation: The migration handles persisted data; code changes are mechanical find-and-replace within well-typed boundaries. TypeScript strict mode catches missed renames at compile time.

**[Auto-execute without user approval]** `post_to` with `auto: true` posts content without a button click. → Mitigation: Content is explicit (Claude specifies it in `content`), frozen via snapshot, and posting is limited to the session's channel fallback chain. Claude cannot target arbitrary channels without the user having provided them. Instructions guide Claude to only use `auto: true` when the user explicitly asked for it.

**[Button handler backward compat]** Existing sessions may have buttons with the old `clack_dm_send_to_thread` action ID. → Mitigation: Button handler regex accepts both old and new action IDs. Old sessions continue to work without migration.
