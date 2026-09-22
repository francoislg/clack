## Context

`executeAndDeliver` opens the progress surface before it runs Claude:

```
executeAndDeliver()                       handlerResponse.ts:170
  ├── handlerFor(silentThinking)          → StreamingDelivery            :209-221
  ├── await ctx.current.windUp()  ◄── opens the card HERE                :239
  ├── await deps.askClaude(...)   ◄── Claude starts thinking HERE        :277
  └── response.skipped → handleSkip → windDown({discard:true}) → chat.delete
```

`StreamingDelivery.windUp` calls `SlackStreamer.start()`, which appends an "Acknowledged" task immediately (`SlackStreamer.start`). That append is what posts the Slack message.

Two facts discovered while scoping make the fix much cheaper than the call-site ordering suggests:

1. **The chat stream is already lazy.** `client.chatStream()` builds a local handle in state `'starting'` and posts nothing; `chat.startStream` fires on the first flush (`@slack/web-api/dist/chat-stream.js:36-43`, `:83-84`). Withholding one append is sufficient to withhold the message. Nothing needs to be buffered or replayed.

2. **A "visible task" predicate already exists.** `getToolLabel` returns `null` for tools in the tool-mapping `hidden` set, and `handleEvent` drops them (`SlackStreamer.onToolStart`). The shipped set is exactly what a commit predicate needs: `ToolSearch` (`_builtins.json`), `submit_response` / `report_status` (`clack.json`).

Replayed against the motivating session, that predicate separates the cases cleanly:

```
SKIPPED TURNS   submit_response{skip_response}  hidden  → never opens
ANSWERING TURN  +4.4s ToolSearch                hidden  → still silent
                +6.2s fetch_channel_messages    VISIBLE → opens, row already real
```

## Goals / Non-Goals

**Goals:**

- A proactive turn that ends in `skip_response` leaves no Slack artifact — nothing posted, nothing deleted, no reaction left behind.
- When a card does open, it opens with a real task on it. It is never empty.
- The attention dial is visible and settable from the Home Tab, and described by what it actually governs.

**Non-Goals:**

- Changing any gate semantics. `"always"` still short-circuits pre-analysis (`attention-level` "Always Level Short-Circuits Pre-Analysis"); the channel-engagement gate still caps `"always"` to `"high"`. A proactive turn that will skip still costs a full Claude run — this change makes it invisible, not free.
- Changing any existing rule's configured level.
- Touching user-initiated triggers. DMs, mentions, reactions and button clicks keep the instant acknowledgement.
- A bottom-of-thread status line. `assistant.threads.setStatus` (used at `agent.ts:34-44`) binds only to assistant/agent threads; a channel thread has no such affordance, so the two-step is necessarily "nothing → card".

## Decisions

### 1. The deferral lives in `SlackStreamer`, not in a new `DeliveryHandler`

The commit predicate and the `hidden` set are the same knowledge. `SlackStreamer` already owns label resolution, so the predicate is one `getToolLabel` call away from where it is decided today.

*Alternatives considered:*

- **Lazy `StreamingDelivery.windUp`.** `DeliveryHandler`'s four-verb shape is explicitly designed for new strategies (`delivery/types.ts`), so this is the architecturally "correct-looking" home. Rejected: the handler would have to import label resolution or carry a duplicate denylist, putting the same knowledge in two places that then drift.
- **A `DeferredDelivery` wrapping `StreamingDelivery`,** using the existing `setDelivery` swap (`handlerResponse.ts:243`). Rejected for the same knowledge-duplication reason, plus it must buffer and replay events — and a replayed `tool_end` whose `tool_start` was hidden is an orphan the inner handler never saw.

Consequence to accept: `start()` returning `true` no longer implies "a Slack message exists". Nothing depends on that today — `getAllMessageTss()` already returns `[]` when nothing was posted (`SlackStreamer.getAllMessageTss`), so a discard iterates nothing.

### 2. Commit on the first `tool_start` with real args and a visible label

Not "first tool call": `ToolSearch` and `submit_response` are tool calls, and in the motivating session `submit_response` was the *only* call in all three skipped turns.

Not "empty-args `tool_start`" for a tool that has a `conditionalHidden` rule: `messageParser.ts:205-210` pre-emits from `tool_progress` with `{}`, and such a rule can still hide the tool once real args arrive (`SlackStreamer.dropHiddenTask`). Committing on that event could open a card and then remove its only row — reintroducing the empty card this change exists to prevent. The real-args event follows within the same assistant message, so waiting costs nothing. A tool with no `conditionalHidden` rule, though, has a label that no argument can change, so its empty-args event is evidence and commits — otherwise a genuinely no-argument tool such as `list_repositories` would never open the card. `toolLabels.ts` gains a small `hasConditionalHiddenRule(toolName)` query for this.

On commit the streamer sends no separate "Acknowledged" append. The first-task path (`SlackStreamer.openTask`) already prepends the thinking row to the new task's chunk (gated on `thinkingFinalized`), so committing only flips the committed flag and starts the keepalive, and that first append creates the message with both rows in one flush.

That opening append is the one flush that runs while the stream has no `ts`, and `ChatStreamer` answers any append or `stop()` made in that window with a second `chat.startStream` — a second message. The streamer therefore marks the committing append as the stream's opening (`openingPending` → `opening`), and every later append, including the keepalive tick and the appends `stop()` makes before `chatStreamer.stop()`, waits for it to settle. A non-deferred stream opens with `start()`'s awaited append, so the window only exists on a deferred one.

*Alternatives considered:* an elapsed-time threshold (see decision 3); an explicit Claude-driven commit via `switch_delivery_context` — rejected, it spends a tool call and a round-trip on something derivable, and depends on Claude remembering to call it.

`switch_delivery_context` joins the `hidden` set in `data/default_configuration/tool_mapping/clack.json`. Its `tool_start` fires before the tool runs, so while it is visible it would commit the deferred card an instant before the switch tears that card down — the exact flash this change removes. Its row is never useful on any card either: a switch to `invisible` discards the card it would sit on, and a switch to `streamer` opens a fresh card that never received the event. Hiding it keeps the commit predicate a single source (the `hidden` set) rather than adding a predicate-specific carve-out.

### 3. Deferral is opt-in, and only proactive triggers opt in

Keyed on the trigger type of the **incoming turn**: `autoRespond`, `threadReply`, `channelReply` defer; `directMessages`, `mentions`, `reactions` and button-click paths do not.

"Incoming turn" matters. The button handlers (`choice.ts`, `retry.ts`, `followup.ts`) call `executeAndDeliver` directly with a `sessionInfo` restored from the session (`activeSessions.ts:56`), which carries the session's *original* trigger type. A Retry click on a thread Clack joined through auto-respond would therefore read as `autoRespond` — yet a human just clicked and is waiting. So `executeAndDeliver` does not derive deferral from `sessionInfo.triggerType`; it takes an explicit `deferProgress` parameter, default `false`. Only `processMessage` sets it, from `isProactiveTrigger(triggerType)` of the message that just arrived. Every button continuation leaves it unset and opens immediately.

One `processMessage` caller borrows a proactive trigger type without being proactive: `startThreadConversation` (`core.ts:798`, backing `sdk.startThreadConversation`) passes `triggerType: "autoRespond"` to get auto-follow session semantics, and documents itself as running on the "common chat streamer". Its only caller is the trivia "Tell me more" button, where a player just clicked and is watching the thread. So `processMessage` also accepts an explicit `deferProgress` override — `params.deferProgress ?? isProactiveTrigger(triggerType)` — and `startThreadConversation` passes `false`. An override is the narrow fix; changing the trigger type would also change the auto-respond session behaviour that caller relies on.

The same override covers the opposite mismatch. The investigations engine's `runInvestigationRound` (`src/investigations/engine.ts`) always uses `triggerType: "mentions"`, but two of its three callers fire with nobody waiting: `handleFollowedThreadEvent` (a message in a followed origin thread passed the classifier, and the round lands on the separate main surface) and `reconcileOneInvestigation` (boot catch-up after downtime). Such a round can still end in `skip_response`, which would reproduce the flash on the investigation surface. So `runInvestigationRound` gains a `deferProgress` option forwarded to `processMessage`: those two background callers pass `{ deferProgress: true }`, while the bootstrap round, which a user just started and is watching, keeps the default.

This is what removes the need for a timeout. A time-bound fallback ("open the card after N seconds even with no visible tool, so the user isn't left hanging") only matters when someone is waiting — and on a proactive turn **nobody asked**. Silence costs nothing. Scoping the deferral to proactive triggers is what makes an unbounded wait safe.

Consequence: a proactive turn that answers using only hidden tools shows no card at all, just the answer. Accepted, and arguably the better outcome — decision 4 makes that path land correctly.

`scheduled` needs no rule of its own: the cron scheduler dispatches every scheduled turn with `silentThinking: true` (`cronScheduler.ts:408`), which selects the silent handler before deferral is ever evaluated.

The predicate lives next to the `TriggerType` union in `src/changes/types.ts`, as a `PROACTIVE_TRIGGERS` set plus `isProactiveTrigger()` — the same shape as the neighbouring `RECOVERY_COMMANDS` / `isRecoveryCommand()`. The trigger-gating family in `src/tools/server.ts` (`shouldAllowSkip`, `shouldAllowAttentionLevel`, …) was considered, but those gate *tool exposure*; importing a tool-server module into the delivery layer would couple two layers that do not otherwise depend on each other.

### 4. An uncommitted stream must never be stopped or flushed

This is the sharpest trap in the change. `ChatStreamer.stop()` **starts the stream if it has not started** (`chat-stream.js:126-136`), and `SlackStreamer.stop()` unconditionally appends a "complete" thinking task when not failed. So on a deferred, never-committed stream:

- `handleSkip` → `windDown({discard:true})` → `stop()` would *create* the message, then delete it — the exact flash being removed.
- The `finally` safety net → `windDown()` → `stop()` would leave an orphaned card on a turn that never had one.

Therefore an uncommitted stream treats `stop()` as a no-op, and `StreamingDelivery.deliver` must route an uncommitted stream to `chat.postMessage` rather than `streamer.stop({blocks})`. The `chat.postMessage` branch already exists as the makeStreamer-failure degradation (`streamingDelivery.ts:67-75`) and returns `notified: true`, which correctly suppresses the follow-up ping (`handlerResponse.ts:467`) — whereas an in-place finalize returns `notified: false` and would trigger a redundant ping on a message that had just been freshly posted.

### 5. The queued follow-up ack is retracted when the run produces no response, not deferred

The `queuedFollowup` 👀 (`core.ts:649`) is added when a message is pushed into an in-flight run, and nothing in core ever removes it — `reactions.remove` exists only as a tool Claude may call (`tools/query/removeReaction.ts:26`). At `attentionLevel: "always"` it is completely ungated, because `autoRespond.ts:312-321` returns before any classifier.

*Alternatives considered:*

- **Defer it until after the decision.** Rejected: its entire value is immediacy — "don't retype, I got it" while the run is live (`core.ts:647-648`). Landing it next to the answer says nothing the answer doesn't.
- **Suppress it on proactive turns.** Rejected: it loses the ack in the case it was built for, a human addressing Clack mid-run in a followed thread.
- **Retract when the run produces no response.** Chosen. The ack stays immediate and becomes honest in both directions. A vanishing *reaction* is not comparable to a vanishing *message*: no notification, no thread bump, nobody watching for it. Both no-response outcomes retract: `handleSkip` (an accepted skip) and `handleCancellation` (a stop). An error outcome keeps the ack, because an error message is posted in reply. A cancellation that lands after the run already delivered (`ctx.alreadyDelivered`, the case `handleCancellation` already returns early for) also keeps it, for the same reason: a response reached the thread. Retraction therefore runs only when the turn delivered nothing.

**Where the record lives.** The ack is added in one `processMessage` invocation (the queuing call, which returns early after `sendUpdate`) and must be retracted by another (the owning run's `executeAndDeliver`). Their only shared object is the `ClaudeRunHandle`: the registry lookup the queuing call uses returns the same handle `askClaude` registered and returned (`src/claude/index.ts:578`, `src/slack/activeRuns.ts` `getForChannelMessage`). The owning run's `ctx.session` cannot carry it — it is captured once at turn start, and `updateSession` replaces the cached object rather than mutating it.

So the record is a Slack-layer side table in `src/slack/activeRuns.ts`: a `WeakMap<ClaudeRunHandle, QueuedAck[]>` (the module already keys `handleKeys` by handle the same way), written by `trackQueuedAck(handle, ack)` and drained by `takeQueuedAcks(handle)`. It is deliberately separate from the registry entry, which `onTerminal` removes when the run settles — before `executeAndDeliver` reads the outcome. It stays off `ClaudeRunHandle`, which is Claude-layer and has no business knowing about Slack reactions. It is in memory only, so no persisted shape changes.

Removal goes through a new `removeDeliveryReaction` in `src/slack/messageReactions.ts`, the counterpart of the existing `addDeliveryReactions`: same narrow client contract, never throws, ignores the benign `no_reaction` error the way the `remove_reaction` tool already does.

Each `QueuedAck` is `{ channel, ts, emoji, added: Promise<void> }`. `added` is the (already fire-and-forget) add call's promise. Retraction awaits it before removing, so a skip that resolves faster than the add cannot remove a reaction that does not exist yet and then watch it land. The ack is recorded in the same continuation as the successful `sendUpdate`, before the follow-up is persisted to the session, so a run that settles during that persistence still finds it when it drains; persistence is best-effort and never routes an already-queued message to the fresh-spawn path. The record is a list because several messages, from several senders, can queue onto one run.

### 6. Attention-level options are labelled by behaviour

`attentionLevel` does not decide whether the triggering message is answered. A matched rule without `preAnalysisContext` fires unconditionally (`autoRespond.ts:472`). A rule with it screens the trigger through pre-analysis, where the level only tunes the classifier's lean and `"always"` is capped to `"high"` (`:469`), so `"always"` buys no extra reliability on the trigger. Beyond that the level is read at `:527` to seed the session, where it governs thread replies:

```
alert posts → rule matches → no preAnalysisContext → fires (level unread)
                                  └─ session seeded with level
                                        └─ humans reply → NOW the level decides
```

So "Attention level" invites the reading *"how reliably does Clack respond?"*, and an admin picking `"always"` for reliability silently opts into a full Claude run on every teammate's `@someone?`. The option text must say what each rung does to thread follow-up, and `"always"` must read as the *unfiltered* choice rather than the eager one. The same framing goes into the auto-respond rule tools' `.describe()` so the surfaces agree. The scheduled-message tools already scope the dial to "the thread created when this scheduled message posts and someone replies", with `"always"` as "no relevance check" — they need no rewording, only to stay consistent.

Each level gets one localized short label, used everywhere the Home Tab shows a level: the new rule-summary suffix and the existing followed-conversation line (`homeTab.ts:1598`), which today interpolates the raw enum value.

## Risks / Trade-offs

- **An uncommitted `stop()` silently creates a message** → decision 4. Highest-value test target: assert zero `chat.startStream` / `chat.postMessage` calls across a full deferred turn that skips, including both teardown paths (`handleSkip` and the `finally` net).
- **The commit predicate is coupled to operator-editable config.** The `hidden` set is extendable via per-server `toolMapping` overrides and plugin mappings, so hiding a tool also stops it opening the card. This is the intended semantics ("not worth a row" ⇒ "not worth a card"), but it means a tool-mapping edit has a delivery-visibility side effect that is not obvious from where it is made. Call it out in the tool-mapping docs.
- **Perceived latency on proactive turns.** The card now appears at the first real tool instead of turn start (+6.2s in the motivating session). Acceptable precisely because nobody is waiting; unacceptable for user-initiated turns, which is why decision 3 scopes it.
- **Deferred turns lose the keepalive during their silent phase.** Held deliberately, since keepalive appends would materialize the message (`SlackStreamer.startKeepalive`). Once committed, keepalive starts normally. A long pre-first-tool stall on a proactive turn is therefore invisible — the intended behaviour, but it means those turns are diagnosable only from logs.
- **A proactive turn that errors still posts its error.** `handleError` posts the error message with its own `chat.postMessage`, independent of the progress surface, so an uncommitted proactive turn that fails still speaks up in the thread. Kept deliberately: a failure that goes silent is worse than a visible one, and the owner's error-report DM depends on the same path.
- **Retraction is best-effort and in memory.** A restart between queuing and the run's outcome loses the record and leaves the ack in place — acceptable, since the run is lost too and a boot never resumes it.
- **Two delivery behaviours to reason about.** A proactive turn and a DM turn now differ in when their surface opens. Mitigated by a single decision point — `processMessage` sets `deferProgress` from the incoming trigger type, nothing else sets it — so the rule stays one line to state.
- **`"always"` rules keep paying full run cost.** Out of scope by decision, but the Home Tab work makes it a UI change rather than a config edit if that is revisited.
