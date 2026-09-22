## Why

On a proactively-triggered turn, Clack makes itself visible before it has decided whether to act. `executeAndDeliver` opens the streaming card at turn start, several seconds before Claude produces anything; when Claude then calls `skip_response`, the card is deleted. In a live alert-channel thread,three consecutive human handoff messages each produced a card that sat visible for 17s, 11s and 10s and then vanished — people saw Clack appear mid-conversation and retract itself three times while typing to each other.

The same turn also leaves a **permanent** false signal: the `queuedFollowup` 👀 reaction is added when a message is pushed into an in-flight run, and nothing ever removes it — so it outlives a turn that skipped.

The dial that governs how often Clack takes these turns, `AutoRespondRule.attentionLevel`, is unreachable and invisible from the Home Tab: rules created there can never set it, the edit modal has no field for it, and the rule list does not show it. An admin cannot see that one rule is on `"always"` while its neighbours are on `"high"` — which is exactly why this behaviour was surprising rather than diagnosable.

## What Changes

**Clack leaves no trace until it has decided to act**

- `SlackStreamer` gains an opt-in deferred mode: the chat-stream handle is constructed (it is lazy — `client.chatStream()` posts nothing until the first flush), but the opening "Acknowledged" append and the keepalive are withheld until the turn commits.
- The commit predicate is the **first `tool_start` carrying real args whose resolved tool label is visible** — i.e. not in the existing `hidden` tool-mapping set (`ToolSearch`, `submit_response`, `report_status`, …). The card therefore opens with a real task already on it, and can never exist empty. Empty-args `tool_start` events (pre-emitted from `tool_progress`) are not evidence, because a `conditionalHidden` rule may still hide the tool once its args arrive.
- Deferral is opt-in per turn and applies to **proactive triggers only** (`autoRespond`, `threadReply`, `channelReply`). Triggers a human aimed at Clack (`directMessages`, `mentions`, `reactions`, button clicks) keep the instant acknowledgement. Because nobody is waiting on a proactive turn, no elapsed-time fallback is needed.
- A proactive turn that produces **no visible tool call** never opens a card; its answer lands through the existing `chat.postMessage` fallback in `StreamingDelivery.deliver`, which reports `notified: true` and so also suppresses the redundant follow-up ping.
- A proactive turn that skips leaves nothing behind — there is no message to delete.

**No artifact outlives a skipped turn**

- When a run ends without a response — `skip_response` or a stop — every `queuedFollowup` reaction added for messages queued onto it is retracted. The ack stays immediate (its whole value is telling the user "don't retype" while the run is live) but is no longer permanent when the run produced nothing.

**The attention dial becomes visible and settable**

- The Home Tab Add Rule and Edit Rule modals gain an attention-level select; the Auto-Respond rule summary shows the level.
- Option labels describe **behaviour**, not eagerness. The dial does not decide whether the triggering message is answered — a matched rule without `preAnalysisContext` fires unconditionally, a rule with it screens the trigger with the level only tuning the classifier's lean (`"always"` capped to `"high"`), and otherwise `attentionLevel` is read when seeding the session, where it governs thread follow-up. Labelling `"always"` as the eager/reliable choice is the misreading that produced this change; it is the *unfiltered* choice.
- The same framing is applied wherever the dial is described to Claude, so the tool surface and the UI agree.

Not in scope: changing any gate semantics. `"always"` still short-circuits pre-analysis, the channel-engagement gate still caps `"always"` to `"high"`, and no existing rule's configured level is altered.

## Capabilities

### New Capabilities
- `deferred-progress-surface`: When a turn may end without a response, its progress surface is withheld until the turn commits to work — the commit predicate, the proactive-trigger scope, and the no-card landing path.

### Modified Capabilities
- `streaming-responses`: Stream Lifecycle no longer unconditionally posts a thinking task at `start()`; Stream Keepalive is held while a stream is deferred.
- `delivery-handler`: the handler abstraction's `windUp` / `deliver` / `windDown` contract admits a deferred streaming surface, and handler selection gains the deferral decision alongside the existing `silent` / `silentThinking` axes.
- `skip-response`: a run that skips, or is cancelled before delivering anything, additionally retracts every queued follow-up reaction added for it.
- `attention-level`: every surface that describes the dial states its real scope (thread follow-up), not eagerness.
- `auto-respond`: the rule UI gains an attention-level field and surfaces the level in the rule summary; a skipped auto-respond turn whose surface never committed leaves no trace without any deletion.
- `home-tab`: the Add Rule and Edit Rule modal field lists gain the attention-level select.

## Impact

- `src/streaming/slackStreamer.ts` — deferred-open option, held keepalive, commit predicate (colocated with `getToolLabel`, which already resolves the `hidden` set).
- `src/slack/handlers/delivery/streamingDelivery.ts`, `src/slack/handlers/delivery/types.ts` — defer flag threaded through `makeStreamer`/`windUp`, uncommitted delivery routed to `chat.postMessage`, `StreamerLike` gains the uncommitted accessor.
- `src/slack/handlers/handlerResponse.ts` — pass the deferral opt-in through `executeAndDeliver`/`makeStreamer`; retract the queued reaction in `handleSkip`.
- `src/slack/handlers/core.ts` — the queued-ack site records each ack against the owning run.
- `src/slack/activeRuns.ts` — an in-memory, handle-keyed side table of queued acks (`trackQueuedAck` / `takeQueuedAcks`).
- `src/slack/messageReactions.ts` — `removeDeliveryReaction`, the counterpart of `addDeliveryReactions`.
- `src/changes/types.ts` — `PROACTIVE_TRIGGERS` / `isProactiveTrigger()` beside the `TriggerType` union.
- `src/investigations/engine.ts` — background investigation rounds request deferral explicitly.
- `src/slack/homeTab.ts` — attention select in the shared rule modal (`buildAutoRespondModal`); level labels in the rule summary and the followed-conversation line.
- `src/slack/handlers/homeTab.ts` — thread the select into `addRule` (currently called with five of six args) and the edit patch.
- `src/tools/actions/addAutoRespondRule.ts`, `src/tools/actions/updateAutoRespondRule.ts`, `src/tools/actions/updateScheduledMessage.ts` — description wording only; parameters are unchanged.
- `src/sessions.ts` — `SETTABLE_ATTENTION_LEVELS`, the one list `SettableAttentionLevel` derives from; the Home Tab select and its parser, the rule and cron-job stores (`autoRespond.ts`, `cronJobs.ts`), the rule and scheduled-message tool schemas, and the SDK cron-spec check (`plugins-sdk/internal/cron.ts`) enumerate it instead of repeating the rungs.
- `data/default_configuration/tool_mapping/clack.json` — `switch_delivery_context` joins the `hidden` set and drops its label entry.
- `src/i18n/strings/en.ts`, `src/i18n/strings/fr.ts` — new Home Tab strings (parity-enforced).
- `.claude/skills/create-tool-mapping/SKILL.md` — note that `hidden` also governs when a deferred card opens.
- No config schema change, no migration, no persisted-shape change. `AutoRespondRule.attentionLevel` already exists and is already parsed; the Home Tab edit path already preserves it (the patch omits it, and `updateRule` only touches present fields), so no rule loses data.
