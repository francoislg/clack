## Context

`SlackStreamer` (`src/streaming/slackStreamer.ts`) wraps a single Slack `chatStream` for the lifetime of one Claude query or worker run. The stream can die mid-flight in three ways, surfaced as Slack error codes when `chat.appendStream` is called:

| Code | Trigger | Today's behavior |
|---|---|---|
| `message_not_in_streaming_state` | Slack server-side expiry (idle window, despite keepalive races) | `warn` log, `failed = true`, caller falls back to `chat.postMessage` at completion |
| `message_not_found` | Assistant API replaced/GC'd the placeholder message | `warn` log, same fallback path |
| `stopped_by_user` | User clicked the stop control in the streaming UI | Currently logged as `error` (noise) — same `failed = true` path |

When this happens mid-run, the user sees a frozen in-progress task card for the rest of the workflow (often tens of seconds) and only gets a final `chat.postMessage` confirmation when Claude completes. All live progress in between is lost. Stream-keepalive (added 2026-04-07) reduced the frequency but does not eliminate it.

Four consumers depend on the streamer's message timestamp via `getMessageTs()`, all in `src/slack/handlers/handlerResponse.ts`:

- Line 291 (`postTopLevel`) — `chat.delete` the in-thread streamer message before posting fresh top-level.
- Line 353 (happy path) — pass as delivery ts to `addDeliveryReactions` and session bookkeeping.
- Line 494 (`handleCancellation`) — `chat.delete` so the cancelled run leaves no trace.
- Line 517 (`handleSkip`) — `chat.delete` so the skipped turn leaves no trace.

The three delete-callers must reach every block the streamer ever opened; the happy-path caller wants only the block that actually carries the final answer.

## Goals / Non-Goals

**Goals:**

- After a recoverable stream failure, automatically open a new `chatStream` in the same channel/thread and continue posting task cards so the user always sees live updates.
- Keep the new block visually distinct enough that the user understands they are seeing a continuation, not a duplicate.
- Respect `stopped_by_user` as an explicit halt — never roll over on it; fix the existing log-noise issue while we're there.
- Bound the worst case: a flapping stream cannot spawn unbounded blocks.
- Keep all delete-style callers correct: skip/cancel/top-level repost must remove every block the streamer opened, not just the first.

**Non-Goals:**

- Carrying SlackStreamer state across blocks (`openGroup`, `taskSlack`, `activeTasks`, etc.). Each block is a clean continuation; in-flight tools from the dying block stay frozen on it forever.
- Proactive rollover (rolling over before a failure, e.g., on a chunk-count budget). Slack does not document a hard chunk cap, and the documented failures are the only reliable trigger we have today. If a documented cap appears later, proactive rollover can layer on top of this design without changes to the public API.
- Per-stream configurability of `MAX_ROLLOVERS` or the continuation thinking title. Constants keep the surface minimal; both can be promoted to constructor options if production data warrants it.
- A separator post between blocks (`chat.postMessage` with "Stream rolled over"). The continuation thinking title is sufficient signal; a separator adds a third message style for marginal gain.

## Decisions

### 1. Reactive rollover, triggered inside `append()`'s catch

The catch block in `append()` (slackStreamer.ts:558–579) already classifies error codes. Rollover lives there:

```
catch (error) {
  if (this.stopped) return;
  const code = getSlackErrorCode(error);

  if (code === "stopped_by_user") {
    this.logger.warn("Stream stopped by user", this.streamDiagnostics());
    this.failed = true; this.stopKeepalive(); return;
  }

  const recoverable = code === "message_not_in_streaming_state" || code === "message_not_found";
  if (recoverable && this.rolloverCount < MAX_ROLLOVERS) {
    const ok = await this.rollover();
    if (ok) {
      try { await this.chatStreamer!.append({ chunks }); return; } catch { /* fall through to failure */ }
    }
  }

  // existing failure logging + this.failed = true + stopKeepalive()
}
```

The failing append's chunks are replayed once against the new stream — otherwise the event that triggered the failure (a `tool_start` or `tool_end`) silently disappears from Block 2.

**Alternative considered:** proactive rollover keyed on chunk count. Rejected — Slack does not document a chunk cap and the implementation would need a tunable threshold guessed from observation. Reactive covers the same failure modes with one mechanism and no magic numbers.

### 2. Hard-clear rollover state, except for the bookkeeping list

`rollover()` opens a new `chatStream` and resets:

| Field | Action |
|---|---|
| `chatStreamer` | replaced with new handle |
| `failed` | `false` |
| `thinkingFinalized` | `false` (Block 2 gets a fresh persistent thinking task) |
| `openGroup` | `null` |
| `taskSlack`, `taskLabels`, `activeTasks` | cleared |
| `lastEventAt`, `lastKeepaliveTickAt` | `now` |
| `messageTss[]` (new) | append previous block's `messageTs`; reset `this.messageTs` to `undefined` so the first append on the new stream captures the new ts |
| `rolloverCount` (new) | `++` |

Clearing `taskSlack`/`taskLabels` is a correctness requirement, not a simplification: if Block 2 received a `tool_end` for a Block-1 taskId and we still had the mapping, it would emit a `task_update` chunk with an id that Block 2 has never seen. Slack would either reject it or create a phantom completed task.

**Alternative considered:** carry over `openGroup` and re-emit its header with the current `(N)` count. Rejected — visually it would create a duplicated group entry across both blocks, and the bookkeeping for "is this tool's `tool_end` going to Block 1 or Block 2?" becomes load-bearing. Not worth the complexity for marginal UX gain.

### 3. Continuation cue lives in Block 2's thinking task title

When `rollover()` succeeds, the new block's first append is the thinking task in `in_progress` status with title `"Continuing previous stream…"` instead of `"Acknowledged, working on it…"`. Once the first real tool starts in Block 2, the thinking task title follows the existing logic (matches the current tool, reverts to "Analyzing…" when tools idle).

This single change is the user-visible signal. No separator message, no "Stream rolled over" thread reply.

**Alternative considered (Option B from exploration):** a tiny `chat.postMessage` between blocks. Rejected — adds a third visual style (regular text reply) to a UX that's deliberately just task cards. The thinking title cue is in-band.

### 4. `MAX_ROLLOVERS = 2`, hardcoded

Worst case becomes 3 blocks before falling back to `chat.postMessage`. Two rollovers give substantial protection against transient Slack expiries without letting a truly broken stream spawn unbounded blocks.

**Alternative considered:** make it configurable via `data/config.json` (e.g., a new `taskCards.maxRollovers` field). Rejected for the initial implementation — we have no production data suggesting one value is wrong, and adding config now means everyone has to think about a knob nobody needs. Promote to config if and when ops needs it.

### 5. Public API: split happy-path ts from delete-path ts list

```
getMessageTs(): string | undefined        // ts of the LATEST block — answer lives here
getAllMessageTss(): string[]              // every block's ts, in order
```

`getMessageTs()` continues to power `addDeliveryReactions` (line 357) and session bookkeeping (line 361) — both want the message where the final answer is rendered, which is always the latest block. Returning the latest ts also keeps the existing semantics for callers in the no-rollover case (one block, latest = first = only).

`getAllMessageTss()` is consumed by the three delete-callers in `handlerResponse.ts`. Each iterates and calls `chat.delete` per ts. Order is preserved (oldest first) so that if any single delete fails, the more recent blocks (which are more visible to the user) are deleted first.

**Alternative considered:** make `getMessageTs()` return all tss and force every caller to iterate. Rejected — it breaks the existing three happy-path call sites that semantically want a single ts (the answer's ts), turning a single-line read into a "pick the one you mean" decision at every call site.

### 6. `stopped_by_user` becomes a `warn`, not an `error`

Pre-existing minor bug in slackStreamer.ts:574: the catch's `else` branch logs anything that isn't `message_not_in_streaming_state` or `message_not_found` as `error`. `stopped_by_user` falls through into that branch. We're already touching the classification logic, so the fix lands here: explicit handler for `stopped_by_user` → `warn` + `failed = true` + return (no rollover).

### 7. Diagnostics expose rollover state

`streamDiagnostics()` gains a `rolloverCount` field. The final-failure log line (the one after the cap is exhausted, or a non-recoverable code surfaces) now includes how many rollovers happened before the stream gave up. Useful for spotting workflows that flap repeatedly.

## Risks / Trade-offs

- **[Frozen task on Block 1 is permanent visual debt]** → Accepted. The frozen in-progress card is the only memorial for the in-flight tool that died mid-run. Removing it would require either re-doing it cleanly on Block 1 (impossible — the stream is dead) or doing it cleanly on Block 2 (requires state migration, which we're explicitly rejecting). The frozen card is also a useful signal that *something* needed rollover.
- **[Duplicate header counts across blocks]** → If a group was `Searching codebase (5)` in Block 1 and the search continues in Block 2, Block 2 starts a fresh `Searching codebase (1)` task. The user sees two cards with the same group title and unrelated counts. Acceptable — the cards are clearly in different blocks, and the alternative (carrying the count over) requires state migration.
- **[Tests that mock `chatStream` need updating]** → The test scaffolding in `slackStreamer.test.ts` uses `makeMockChatStreamer()` and `makeClient({chatStreamer})` that returns a single mock from `chatStream()`. Rollover tests need a multi-stream mock that returns successive streamers on successive `chatStream()` calls. Bounded scope — only the new tests need the new helper.
- **[Flapping streams could rollover-rollover-rollover-fallback fast]** → `MAX_ROLLOVERS = 2` caps it at 3 blocks. Worst case three rapid stream-open API calls before falling back, which is well within rate limits. The completion log surfaces flapping so ops can investigate.
- **[The replayed failing append could itself fail]** → Caught and falls through into the existing failure path. If the brand-new stream is *also* rejecting the chunks, that's a Slack-side problem; failing once and reporting it is the right behavior.

## Migration Plan

No data migration. The new fields (`messageTss`, `rolloverCount`) are internal to `SlackStreamer` instances and are reset every time a new streamer is constructed.

Caller updates (the three delete sites in `handlerResponse.ts`) are mechanical: replace `getMessageTs()` with iteration over `getAllMessageTss()`. Backward-compatible — in the no-rollover case the array has length 1 and behavior is identical.

Rollback is a single revert if production data exposes an unexpected issue.

## Open Questions

None. The exploration phase resolved every open thread:

1. State migration: don't (per user direction).
2. Continuation cue: thinking title (Option C).
3. Rollover cap: 2 (3 blocks total), hardcoded for now.
4. `stopped_by_user`: hard exit + log fix.
5. `getMessageTs()` semantics: latest block; new `getAllMessageTss()` for delete callers.
