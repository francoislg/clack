## Context

Clack currently runs Claude to completion via `askClaude()`, which iterates over the Agent SDK's `query()` async generator, collects tool call traces, and returns a `ClaudeResponse` object. The caller (`processMessage` in `core.ts`) then posts the full response to Slack in one shot via `chat.postMessage` or `chat.update`.

The Agent SDK already streams events in real-time — every tool call, every assistant turn flows through the `for await` loop. Clack ignores all intermediate events and waits for the `result` message. The data needed for live progress updates is already available; it's just not surfaced to Slack.

Slack's `@slack/web-api` 7.13.0 (already installed) supports `chat.startStream`/`appendStream`/`stopStream` with `task_card`/`plan` blocks and `context_actions` feedback buttons.

Separately, ephemeral response delivery adds significant complexity (accept/reject/refine buttons, hidden thread notifications, DM-first as an escape hatch). Removing it simplifies the codebase and aligns with the streaming approach, since `chat.startStream` always produces visible messages.

## Goals / Non-Goals

**Goals:**
- Show Claude's tool calls as live task cards in a plan block while processing
- Stream the final answer text as it becomes available
- Remove ephemeral response delivery entirely
- Simplify reaction delivery to two modes: DM or Thread (user preference)
- Maintain all existing functionality for DMs, mentions, and the Changes Workflow
- Show worker flow progress (commits, pushes, PR creation) as live task cards in the change thread

**Non-Goals:**
- Streaming the answer token-by-token from the Claude Agent SDK (the SDK doesn't expose sub-message text deltas — we get full assistant messages; the streaming here is about tool progress + final answer delivery)
- Adding the Slack "Agents & AI Apps" assistant container / split-pane experience
- Adding suggested prompts or thread titles (those require the Agents & AI Apps feature)

## Decisions

### 1. Event emission via callback, not async generator

**Decision**: Add an optional `onEvent` callback to `askClaude()` rather than converting it to an async generator.

**Rationale**: `askClaude` currently returns `ClaudeResponse` with structured fields (response, renderedBlocks, stagedIntents, toolCallHistory). Converting to a generator would require the caller to reconstruct this from yielded events. A callback lets us emit progress events for streaming while keeping the return type intact.

```ts
interface StreamEvent {
  type: "tool_start" | "tool_end" | "text";
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  taskId?: string;
  text?: string;
}

interface AskClaudeOptions {
  // ... existing fields
  onEvent?: (event: StreamEvent) => void;
}
```

**Alternative considered**: Async generator (`async function*`). More idiomatic but forces callers to consume the stream and reconstruct the final result. The callback approach is less invasive — non-streaming callers (like `summarizeForSlack`, `analyzeError`) are unaffected.

### 2. Streaming orchestration in `processMessage`, not in `askClaude`

**Decision**: `processMessage` manages the Slack stream lifecycle (start/append/stop). `askClaude` just emits events; it has no knowledge of Slack.

**Rationale**: Keeps `askClaude` as a pure Claude interface. Slack-specific concerns (which channel, which thread, how to render task cards) stay in the Slack layer. This also makes it easy to not stream in specific cases (e.g., if we later need a non-streaming path).

### 3. Tool-to-task-card mapping as a static registry

**Decision**: Maintain a simple mapping from tool names to human-readable labels, with a catch-all for unknown tools.

```ts
const TOOL_LABELS: Record<string, string | ((args: Record<string, unknown>) => string)> = {
  "Read": (args) => `Reading ${args.file_path || "file"}`,
  "Glob": "Searching for files",
  "Grep": "Searching codebase",
  "mcp__clack__list_repositories": "Listing repositories",
  "mcp__clack__git_log": "Reading git history",
  "mcp__clack__find_sessions": "Finding sessions",
  "mcp__clack__submit_response": null,  // Don't show as task card
  // ... etc
};
```

Tools prefixed with `mcp__github__` get "Checking GitHub". Unknown tools get a generic "Processing..." label. `submit_response` is excluded (it's the answer, not a step).

**Alternative considered**: Dynamic labels from Claude (ask it to describe what it's doing). Too slow and unreliable — the label needs to appear instantly when the tool call starts.

### 4. Plan display mode, not timeline

**Decision**: Use `task_display_mode: "plan"` so all task cards group into a single collapsible plan block.

**Rationale**: Timeline mode scatters individual task cards through the message, which is noisy for a Q&A interaction. Plan mode gives a clean "here's what I did" summary that collapses when the answer appears.

### 5. Replace `dmOptOut` with `reactionDelivery` preference

**Decision**: Replace the `dmOptOut: boolean` preference with `reactionDelivery: "dm" | "thread"`. Default to `"dm"`.

**Rationale**: `dmOptOut` was a negation (opt OUT of DM → get ephemeral). With ephemeral gone, the preference is a direct positive choice: "where do you want reaction answers?" Defaulting to `"dm"` preserves existing behavior for users who had DM delivery before.

### 6. Thinking feedback replaced by stream start

**Decision**: Remove the separate thinking feedback system (emoji reactions, "Investigating..." messages). The stream's plan block with a persistent "thinking" task card IS the thinking indicator.

**Rationale**: Starting a stream with an initial plan block immediately shows the user that Clack is working. This replaces all three current thinking strategies (emoji, ephemeral acknowledgment, "Investigating..." message). The emoji reaction for thinking specifically goes away — the stream itself is the feedback.

**Thinking task lifecycle**: A dedicated `__thinking__` task card stays in `in_progress` throughout the query:
1. Starts as "Acknowledged, working on it…"
2. Updates its title to match the current tool's label when a tool starts (e.g., "Reading src/config.ts")
3. Reverts to "Analyzing…" when a tool completes
4. Marked `complete` when the stream stops

This gives the user a persistent sense of "what's happening right now" alongside the growing list of completed tool task cards.

### 7. Worker flow streaming via same `onEvent` pattern

**Decision**: Add the same `onEvent` callback to `runClaude()` in `execution.ts`. The Changes Workflow caller (`changes/workflow.ts`) manages a Slack stream in the change thread, showing worker tool calls (Read, Write, Bash, git_push, ensure_pr, etc.) as task cards.

**Rationale**: `runClaude` already has `onProgress` callbacks and follows the same `for await` pattern as `askClaude`. The streaming integration is nearly identical — just a different set of tool labels (worker tools like `git_push`, `ensure_pr`, `report_status` alongside file tools like Write, Edit, Bash). The worker flow's change thread is the natural stream target.

Worker-specific tool labels:
- `Write` / `Edit` → "Modifying {file}"
- `Bash` → "Running command"
- `mcp__clack__git_push` → "Pushing to remote"
- `mcp__clack__ensure_pr` → "Creating pull request"
- `mcp__clack__report_status` → (excluded, like submit_response)
- `mcp__clack__merge_pr` → "Merging pull request"

**Alternative considered**: Separate streaming implementation for worker flow. Rejected — the same `StreamEvent` type and `onEvent` callback pattern works for both query and worker modes. Only the tool label registry and stream target differ.

### 8. Stream lifecycle and error handling

**Decision**: If the stream fails (Slack API error) during `appendStream`, fall back to collecting the full response and posting it traditionally at the end. If `stopStream` fails, the message is already partially visible — log the error but don't retry. The `SlackStreamer` exposes a `hasFailed` flag that the caller checks after Claude completes.

**Rationale**: Streaming is a UX enhancement. If it degrades, the answer should still get delivered. The caller (`processMessage`) checks `streamer.hasFailed` and falls back to `chat.postMessage` with the full rendered blocks. A `finally` block ensures `streamer.stop()` is always called to prevent orphaned streams.

### 9. No debouncing (deferred)

**Decision**: Stream updates are sent synchronously on every `tool_start` and `tool_end` event, without debouncing.

**Rationale**: Initial implementation keeps it simple. The Slack chat streaming API handles rapid updates well in practice — the SDK's `chatStream` helper manages batching internally. If rate limiting becomes an issue in production, debouncing can be added to `SlackStreamer.append()` later without changing the public API.

### 10. No incremental text streaming

**Decision**: The answer text is delivered entirely in the `stopStream` call, not streamed incrementally via `appendStream`.

**Rationale**: The Claude Agent SDK yields complete assistant messages, not token-level deltas. The `text` event type is defined in `StreamEvent` for future use but is currently not emitted. The streamer's `text` handler is a no-op. If the SDK later supports sub-message text deltas, incremental text streaming can be added without changing the event interface.

## Risks / Trade-offs

- **Plan block support**: `task_card` and `plan` blocks are new (Feb 2026). They may not render on older Slack clients or all workspace plans. → Test on target workspaces. Fall back to regular message if blocks are rejected.
- **Rate limiting on appendStream**: Rapid tool calls could hit Slack API rate limits if we update the plan on every tool start/end. → Debounce updates (e.g., max one `appendStream` per 500ms, batch pending updates).
- **No token-level streaming**: The Claude Agent SDK yields complete assistant messages, not token deltas. The "streaming" of the answer text is really "post the answer via appendStream once submit_response is called" — which is still better than the current approach (the plan updates are truly live). → If the SDK later supports text deltas, we can enhance.
- **Migration**: Removing ephemeral and changing user preferences requires a boot migration. Configs with `reactions.responseType: "ephemeral"` need updating. → Create a migration that removes the field and converts `dmOptOut` → `reactionDelivery`.
- **Breaking change for ephemeral users**: Users who relied on private ephemeral responses lose that capability. → DM mode provides a private alternative. Document in migration notes.
