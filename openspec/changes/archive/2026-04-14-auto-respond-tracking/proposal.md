## Why

Auto-respond thread tracking is implicit today: if a session exists for a thread, Clack evaluates every message through pre-analysis indefinitely (up to 30-day session expiry). This means threads where the conversation has moved on still incur Sonnet classifier costs on every message, and there's no way for a user to tell Clack to stop following a thread. Making tracking explicit with an `autoResponseActive` flag enables cost savings, cleaner disengagement, and user control over Clack's presence in threads.

## What Changes

- Add `autoResponseActive` boolean field to `SessionContext`, defaulting to `true` when Clack first responds in a thread
- Thread auto-respond checks `autoResponseActive` before running pre-analysis; if `false`, skip immediately (no classifier cost)
- Pre-analysis classifier gains a third outcome `"stop"` (alongside `"skip"` and `"respond"`) that sets `autoResponseActive = false`
- `submit_response` gains a `disengage` flag that combines `skip_response` behavior with setting `autoResponseActive = false`
- New `stop_tracking` query tool for cross-thread disengagement (e.g., user in DM says "stop tracking this thread: <url>")
- @mentioning Clack in a disengaged thread implicitly re-activates `autoResponseActive = true`

## Capabilities

### New Capabilities
- `auto-respond-tracking`: Explicit session-level flag for auto-respond engagement state, with disengagement and re-activation paths

### Modified Capabilities
- `auto-respond`: Thread auto-respond path checks `autoResponseActive` before evaluation; @mention handler re-activates tracking
- `auto-respond-pre-analysis`: Classifier gains third `"stop"` outcome that triggers disengagement
- `skip-response`: `submit_response` gains `disengage` flag for post-analysis disengagement
- `session-management`: `SessionContext` gains `autoResponseActive` field
- `clack-tools`: New `stop_tracking` query tool registered when Slack client is available

## Impact

- **Session persistence**: `autoResponseActive` must be persisted in `context.json` to survive restarts
- **Pre-analysis**: Return type changes from `boolean` to a three-value result (`respond` / `skip` / `stop`)
- **Auto-respond handler**: New early-exit check on `autoResponseActive` before pre-analysis
- **Mention handler**: Must detect disengaged sessions and re-activate them
- **Submit response**: Schema extension for `disengage` flag, session update on acceptance
- **Tool server**: New `stop_tracking` tool registration (Slack client required)
- **Prompt builder**: Guidance for Claude on when to use `disengage` vs plain `skip_response`
