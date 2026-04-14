## Context

Auto-respond thread tracking is currently implicit: a session's existence is the sole signal that Clack should evaluate thread messages. Pre-analysis runs a Sonnet classifier on every message in a tracked thread, returning a binary `respond`/`skip` result. Claude (Opus) can additionally skip via `skip_response` on `submit_response`. Neither mechanism permanently disengages Clack from a thread.

The system has three entry points for thread interaction:
1. **Auto-respond handler** (`autoRespond.ts`) — evaluates thread replies via pre-analysis
2. **Mention handler** (`mention.ts`) — processes explicit @mentions
3. **Core processing** (`core.ts`) — creates/updates sessions

Sessions persist to `data/sessions/{id}/context.json` and are indexed in-memory by `channel:threadTs`.

## Goals / Non-Goals

**Goals:**
- Make thread engagement state explicit via `autoResponseActive` on `SessionContext`
- Provide three disengagement paths: pre-analysis "stop", submit_response `disengage` flag, cross-thread `stop_tracking` tool
- Re-activate tracking implicitly when Clack is @mentioned in a disengaged thread
- Reduce unnecessary pre-analysis and Claude invocations on threads where Clack is no longer needed

**Non-Goals:**
- Mechanical skip counters (e.g., "N consecutive skips = disengage") — the classifier and Claude handle this semantically
- UI for viewing/toggling tracking state from the Home Tab
- Changing how top-level auto-respond rules work (only thread tracking is affected)
- Re-activation via anything other than @mention (e.g., reactions, keywords)

## Decisions

### Decision 1: Pre-analysis returns a tri-state instead of boolean

**Choice**: `runPreAnalysis()` returns `"respond" | "skip" | "stop"` instead of `boolean`.

**Rationale**: The classifier already sees 10 messages of context. It can distinguish "this specific message isn't for me" (skip) from "this conversation has moved on entirely" (stop). A tri-state keeps the function signature simple while enabling disengagement at the cheapest layer.

**Alternative considered**: Separate "should disengage?" classifier call. Rejected — doubles the cost per message with no benefit over a single tri-state call.

**Migration**: All existing callers check `result === true` or `shouldRespond`. These become `result === "respond"`. The thread auto-respond path additionally checks for `"stop"` to set `autoResponseActive = false`.

### Decision 2: `disengage` flag on `submit_response` rather than a separate tool

**Choice**: Add `disengage: boolean` to `submit_response` schema (only available when `skip_response` is also available).

**Rationale**: Disengagement from within a running session is semantically "skip + stop tracking." It's a modifier on the existing skip behavior, not a distinct action. A flag avoids tool proliferation and keeps the response flow in one place.

**Alternative considered**: Separate `disengage_thread` tool. Rejected for in-session use since it would need to duplicate skip logic. However, cross-thread disengagement does need a separate tool (see Decision 3).

### Decision 3: Separate `stop_tracking` tool for cross-thread disengagement

**Choice**: New query tool `stop_tracking` that accepts a Slack message URL, resolves the thread, finds the session, and sets `autoResponseActive = false`.

**Rationale**: Cross-thread disengagement (e.g., "stop tracking that thread" from a DM) can't use `submit_response` because the user is in a different session. This tool leverages existing URL parsing from `fetch_slack_message` and the session lookup from `findSessionByThread`.

**Gating**: Registered when a Slack client is available, for all roles (any user can stop tracking their own threads). The tool validates that the requesting user was the original session creator or has admin+ role.

### Decision 4: @mention re-activation happens in the mention handler

**Choice**: When the mention handler processes a message and finds a session with `autoResponseActive === false`, it sets it back to `true` before proceeding.

**Rationale**: The mention handler already looks up sessions via `findSessionByThread`. Adding a flag flip is minimal. This keeps re-activation implicit — no new tool or button needed.

**Edge case**: If no session exists yet (first interaction), `autoResponseActive` defaults to `true` on creation, so no special handling needed.

### Decision 5: `autoResponseActive` defaults to `true` and is persisted

**Choice**: The field defaults to `true` on session creation and is persisted in `context.json`.

**Rationale**: Must survive restarts. If it were memory-only, a restart would re-activate all disengaged threads. Defaulting to `true` means existing sessions (created before this change) behave as today — no migration needed.

## Risks / Trade-offs

**[Pre-analysis "stop" too aggressive]** The classifier might disengage prematurely on threads with bursty activity patterns (e.g., 5 minutes of off-topic chat, then a genuine follow-up). **Mitigation**: The prompt emphasizes that "stop" should only be used when the thread has clearly moved on from the original topic, not just for momentary noise. And re-activation via @mention is always available.

**[Pre-analysis "stop" too conservative]** The classifier might never confidently say "stop" and always fall back to "skip", making the pre-analysis layer ineffective for disengagement. **Mitigation**: Claude (Opus) as the second layer can disengage via `disengage` flag. Over time, pre-analysis prompt can be tuned based on observed patterns.

**[Cross-thread stop_tracking abuse]** A user could disengage threads they didn't create. **Mitigation**: Validate that the requesting user is the session creator or has admin+ role.

**[No re-activation path beyond @mention]** If someone replies to Clack's message without @mentioning, tracking stays off. **Mitigation**: This is acceptable — an explicit @mention is a clear, low-friction signal. We can revisit if users report friction.
