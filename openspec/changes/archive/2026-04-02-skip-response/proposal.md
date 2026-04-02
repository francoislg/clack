## Why

Auto-respond pre-analysis is a lightweight gate (fast Sonnet call) that decides whether to respond. But it lacks full context — it can't read tools, inspect the thread deeply, or reason about conversation dynamics. When it says "respond" and the main Claude session starts, Claude sometimes discovers there's nothing useful to say (e.g., users are talking to each other, the question was already answered, or the message isn't actually directed at Clack). Today, Claude has no way to gracefully exit — it must always produce a response via `submit_response`, even when silence would be better.

## What Changes

- Add an optional `skip_response` boolean flag to the `submit_response` tool, gated to auto-respond and thread-reply trigger types only
- When `skip_response: true`, require the `message` field to match an exact acknowledgment string as a safeguard against accidental skips — reject the tool call with an error containing the required string if it doesn't match (Claude retries with the correct message)
- When skip is accepted: don't deliver, don't persist the session, delete the streamer's thinking indicator message from Slack (as if Clack never responded)
- Expose the streaming message `ts` from `SlackStreamer` so the message can be deleted after skip
- Add auto-respond prompt guidance telling Claude it can skip when the conversation doesn't need a Clack response

## Capabilities

### New Capabilities
- `skip-response`: The `submit_response` skip flag, safeguard validation, message deletion, and session cleanup behavior

### Modified Capabilities
- `clack-tool-response`: `submit_response` gains the optional `skip_response` flag with conditional schema relaxation (sections not required when skipping)
- `streaming-responses`: `SlackStreamer` exposes message `ts` for post-skip deletion
- `auto-respond`: Prompt guidance for when to skip, and `skip_response` flag only available in auto-respond/thread-reply contexts

## Impact

- **Tool schema**: `submit_response` gains `skip_response` (boolean) and relaxes `sections` requirement when skip is true
- **SlackStreamer**: Must capture and expose the message `ts` from the Slack streaming API
- **Response pipeline**: `executeAndDeliver` gains a new `response.skipped` path that deletes the streamer message instead of delivering
- **Prompt builder**: Auto-respond delivery context instructions updated to mention skip capability
- **ResponseCapture / ClaudeResponse**: Extended with a `skipped` flag that propagates from tool handler through to the orchestration layer
