## Why

Clack currently runs Claude to completion in silence, then posts the full answer in one shot. Users see either a thinking emoji or an "Investigating..." message, then a long pause, then the complete response. Slack now supports streaming responses (`chat.startStream`/`appendStream`/`stopStream`) with new block types — `task_card`, `plan`, and `context_actions` — designed specifically for AI agent UX. Adopting these gives users real-time visibility into what Claude is doing (tool calls as task cards) and the answer as it forms (streamed markdown), replacing the current "black box" experience.

This is also the right time to remove ephemeral responses entirely. Ephemeral was a compromise — reactions post invisible responses that only the reactor sees, requiring accept/reject/refine buttons. With streaming visible in threads (or via DM), the UX is cleaner and the codebase significantly simpler.

## What Changes

- **Add streaming responses**: Replace one-shot `chat.postMessage`/`chat.update` with `chat.startStream`/`appendStream`/`stopStream` for all trigger modes
- **Add plan blocks**: Map Claude's tool calls to `task_card` blocks within a `plan` block, updated live as tools execute
- **Remove ephemeral responses entirely** (**BREAKING**): Reactions no longer post ephemeral messages. The `reactions.responseType` config option is removed.
- **Simplify reaction delivery to two modes**: "DM" (private, with send-to-thread) or "Thread" (visible in channel thread). User preference selects between them.
- **Remove accept/reject/refine actions**: These only existed for ephemeral. DM mode keeps `send_to_thread`. Thread mode needs no delivery actions.
- **Restructure `askClaude`**: Change from a batch async function returning `ClaudeResponse` to a callback-based approach that emits events as Claude runs, enabling the caller to stream updates to Slack in real time.
- **Add streaming to worker flow**: The Changes Workflow (`runClaude`/`executeChange`) also gets streaming with plan blocks, showing tool calls (Read, Write, Edit, Bash, git_push, ensure_pr, etc.) as live task cards in the change thread.

## Capabilities

### New Capabilities
- `streaming-responses`: Real-time streaming of Claude's answer text and tool call progress to Slack using the chat streaming API and plan/task_card blocks
### Modified Capabilities
- `slack-reaction-trigger`: Remove ephemeral response delivery. Reactions now post visible messages (in thread or via DM based on user preference). Remove accept/reject/refine actions. Remove `reactions.responseType` config.
- `dm-first-reactions`: Simplify to be one of two reaction delivery modes ("DM" vs "Thread"). Remove ephemeral fallback and `dmOptOut` framing. The DM flow itself (investigation notice, thread-based refinement, send-to-thread) remains but gets streaming.
- `delivery-context`: Update delivery context to reflect new modes — no more ephemeral mode. DM and Thread modes for reactions, same visible-thread mode for DMs and mentions.
- `clack-tool-response`: Remove `accept`, `reject`, `edit`, `refine` action types (ephemeral-only).
- `user-preferences`: Replace `dmOptOut` with a positive `reactionDelivery` preference (`"dm"` | `"thread"`). Default is `"dm"` to preserve current default behavior for existing users.
- `request-cancellation`: Remove `ThinkingState` from in-flight registry. Stream cleanup handled by `processMessage` instead of message edit handler.
- `auto-execute-actions`: Pass `dmChannel`/`dmThreadTs` to auto-execute handler so progress streams to the correct location in DM mode.
- `error-reporting`: Remove block posting retry and plain text fallback. Errors delivered via stream (or `chat.postMessage` fallback).
- `session-management`: Remove `isEphemeral` from session context. Remove `"refine"` from `ContinuationRecord` action types.
- `slack-message-trigger`: Replace "Investigating..." message pattern with streaming for DMs and mentions.
- `claude-code-integration`: Add `onEvent` streaming callback to both `askClaude()` and `runClaude()` for real-time tool progress events.
- `home-tab`: Settings modal updated from DM opt-out toggle to reaction delivery preference (DM/Thread). Always shown, no longer conditional on `responseType` config.

## Impact

- **Slack SDK**: Already have `@slack/web-api` 7.13.0 with `chat.startStream`/`appendStream`/`stopStream` and `chatStream` helper
- **Config**: `reactions.responseType` removed. Migration needed for existing configs.
- **User preferences**: `dmOptOut` replaced with `reactionDelivery`. Migration needed.
- **Core architecture**: `askClaude()` and `runClaude()` gain `onEvent` callbacks — affects `processMessage()`, `executeChange()`, and all callers
- **Block Kit**: New block types (`task_card`, `plan`) — verify Slack workspace plan supports them
- **Deleted code**: Ephemeral posting paths, `notifyHiddenThread`, `getEffectiveResponseType()`, `ThinkingState`, block retry logic (`retryWithBlockError`, `isSlackBlockError`, `postPlainTextFallback`), thinking feedback system (`showThinkingFeedback`, `removeThinkingEmoji`)
- **Button handlers**: `accept`, `reject`, `edit`, `refine`, `update` (standalone) handlers removed. `send_to_thread` stays. Change thread follow-up handlers (`review`, `merge`, `update`, `close`) refactored with streaming.
- **Settings modal**: Repurposed for `reactionDelivery` preference (DM / Thread radio buttons). Always shown, no longer conditional on `responseType`.
