## 1. Stream Event Infrastructure

- [x] 1.1 Define `StreamEvent` type (`tool_start`, `tool_end`, `text`) in a new `src/streaming/types.ts` module
- [x] 1.2 Create tool label registry in `src/streaming/toolLabels.ts` — static mapping of tool names to human-readable labels, with dynamic label support (e.g., `Read` → "Reading {file_path}") and `null` for excluded tools (submit_response, report_status)
- [x] 1.3 Create `SlackStreamer` class in `src/streaming/slackStreamer.ts` — wraps `chatStream` helper (which manages `startStream`/`appendStream`/`stopStream`), manages plan block state with a persistent "thinking" task card, and provides `handleEvent`/`start`/`stop` methods. Exposes `hasFailed` flag for fallback detection. No debouncing (deferred).

## 2. Query Flow Integration

- [x] 2.1 Add `onEvent` callback to `AskClaudeOptions` in `src/claude.ts` — emit `tool_start` events when `tool_use` blocks appear, `tool_end` when tool results arrive, and capture the tool call ID to correlate start/end
- [x] 2.2 Refactor `processMessage` in `src/slack/handlers/core.ts` — replace `showThinkingFeedback` + one-shot posting with: create `SlackStreamer`, wire it to `askClaude`'s `onEvent`, and stop the stream with final blocks on completion
- [x] 2.3 Update `postSuccessResponse` to work with streaming — on stream stop, include rendered blocks (action buttons) via `stopStream`. Remove the `thinkingMessageTs` update pattern.

## 3. Worker Flow Integration

- [x] 3.1 Add `onEvent` callback to `runClaude` options in `src/changes/execution.ts` — emit `StreamEvent`s from the existing `for await` loop (tool_use blocks already detected on line 106)
- [x] 3.2 Update change action handlers (`changeAction.ts`, `changeThreadActions.ts`) to create `SlackStreamer` in the change thread and pass `streamer.handleEvent` through the workflow to `runClaude`'s `onEvent` callback
- [x] 3.3 Add worker-specific tool labels to the registry (git_push → "Pushing to remote", ensure_pr → "Creating pull request", merge_pr → "Merging pull request", report_status → excluded)

## 4. DM Streaming Path

- [x] 4.1 Update DM-first reaction flow in `src/slack/dmResponse.ts` — replace investigation notice + answer post with streaming in the DM thread. `SlackStreamer` targets the DM channel/thread instead of the channel thread.
- [x] 4.2 Update `processMessage` DM-first path — open DM, start stream in DM thread, same `SlackStreamer` interface

## 5. Remove Ephemeral System

- [x] 5.1 Remove ephemeral response posting from `src/slack/handlers/core.ts` — delete `postEphemeralResponse`, `notifyHiddenThread`, and all `isEphemeral` branching
- [x] 5.2 Remove accept/reject/refine button handlers from `src/slack/app.ts` and their handler files
- [x] 5.3 Remove `getEffectiveResponseType` from `src/userPreferences.ts` and all callers
- [x] 5.4 Remove thinking feedback system — delete `showThinkingFeedback`, `removeThinkingEmoji` usage from processing flow. Note: `ThinkingFeedbackConfig` type and `thinking` field remain in config.ts as dead code (not read by any handler). Cleanup deferred.
- [x] 5.5 Remove `reactions.responseType` from config type definitions and validation in `src/config.ts`
- [x] 5.6 Remove `isEphemeral` from `SessionContext` type and session persistence
- [x] 5.7 Clean up `src/slack/blocks.ts` — remove `getInvestigatingBlocks` and any ephemeral-specific block builders

## 6. Update Delivery Context

- [x] 6.1 Update `buildDeliveryContext` in `src/claude.ts` — remove ephemeral mode case, update DM-reaction and Thread-reaction cases
- [x] 6.2 Remove `accept`, `reject`, `edit`, `refine` from action type definitions in `src/tools/types.ts`
- [x] 6.3 Update submit_response tool validation to reject removed action types
- [x] 6.4 Update instruction files in `data/default_configuration/` — remove references to ephemeral mode, accept/reject/refine actions

## 7. User Preferences Migration

- [x] 7.1 Replace `dmOptOut: boolean` with `reactionDelivery: "dm" | "thread"` in `src/userPreferences.ts`
- [x] 7.2 Update Home Tab settings modal to show "DM" / "Thread" preference instead of DM opt-out toggle
- [x] 7.3 Create boot migration to convert config (`reactions.responseType` removal) and user preferences (`dmOptOut` → `reactionDelivery`)

## 8. Manifest & Config Cleanup

- [x] 8.1 Update `scripts/generate-manifest.ts` — remove conditional logic for `reactions.responseType`
- [x] 8.2 Remove `notifyHiddenThread` config option from type definitions and manifest generation
- [x] 8.3 Update `src/slack/app.ts` handler registration — remove accept/reject/refine handler registrations, add feedback event handler if needed later

## 10. Worker Stream Keepalive

- [x] 10.1 Pass `onEvent` through to `runWorktreeSetup()` — added parameter to `execution.ts` and forwarded from `workflow.ts`. Real tool calls (Bash, Read, etc.) during setup now keep the stream alive naturally, and the user sees actual setup progress instead of a single idle task.
- [x] ~~10.2 Add `__worktree_setup__` label~~ — Not needed. Forwarding real events is better than synthetic ones.
- [x] ~~10.3 Do the same for follow-up flows~~ — N/A, `handleFollowUp` operates on existing worktrees and doesn't run setup

## 9. Testing

- [ ] 9.1 Test streaming with all trigger modes — reaction (DM), reaction (thread), DM, @mention
- [ ] 9.2 Test worker flow streaming — change execution with task card progress
- [ ] 9.3 Test stream fallback — verify graceful degradation when streaming API fails
- [ ] ~~9.4 Test debouncing~~ — deferred, no debouncing implemented
- [ ] 9.5 Test migration — existing configs and user preferences are correctly converted
- [ ] 9.6 Test DM refinement — thread replies in DM still work with streaming
