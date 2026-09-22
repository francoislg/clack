# deferred-progress-surface Specification

## Purpose
A turn nobody aimed at Clack (auto-respond, thread reply, channel reply) may end without a response. Its progress surface is withheld until the turn commits to visible work, so a turn that skips leaves no trace in the conversation.
## Requirements
### Requirement: Deferred Progress Surface

A streaming progress surface MAY be opened in **deferred** mode. A deferred surface SHALL post nothing to Slack — no message, no thinking task, no keepalive — until the turn commits (see Commit Predicate). Before it commits, the surface is **uncommitted**; after it commits, it behaves exactly as a non-deferred streaming surface.

The underlying chat-stream handle SHALL still be constructed at wind-up, so stream events are received and evaluated. Only the first append is withheld.

#### Scenario: Uncommitted surface posts nothing

- **GIVEN** a turn whose progress surface was opened in deferred mode
- **WHEN** the turn runs and no committing event occurs
- **THEN** no `chat.startStream`, `chat.appendStream`, or `chat.postMessage` call is made for the progress surface
- **AND** no keepalive append is emitted

#### Scenario: Committed surface behaves as a normal streaming surface

- **GIVEN** a deferred surface that has committed
- **WHEN** subsequent stream events arrive
- **THEN** they are rendered on the card exactly as for a non-deferred surface
- **AND** the keepalive timer is running

#### Scenario: Handle is constructed even while uncommitted

- **GIVEN** a turn whose progress surface was opened in deferred mode
- **WHEN** a stream event arrives before the surface has committed
- **THEN** the event is evaluated against the commit predicate rather than dropped

### Requirement: Commit Predicate

A deferred surface SHALL commit on the first `tool_start` event whose tool resolves to a non-null tool label (i.e. the tool is not in the tool-mapping `hidden` set, and no `conditionalHidden` rule matches its arguments) AND whose label cannot still change once arguments arrive — that is, the event carries non-empty arguments, or the tool has no `conditionalHidden` rule at all. No other event SHALL commit the surface.

On commit, the surface SHALL open with that tool's task in its first append — alongside the thinking row that heads every card — so a card never exists without a visible tool task on it.

#### Scenario: Hidden tool does not commit

- **GIVEN** an uncommitted deferred surface
- **WHEN** a `tool_start` event arrives for a tool in the `hidden` set (for example `ToolSearch`, `submit_response`, or `report_status`)
- **THEN** the surface remains uncommitted and posts nothing

#### Scenario: Empty-args tool_start does not commit a tool with a conditionalHidden rule

- **GIVEN** an uncommitted deferred surface
- **AND** a tool that has a `conditionalHidden` rule
- **WHEN** a `tool_start` event for it arrives with an empty arguments object (pre-emitted from `tool_progress`)
- **THEN** the surface remains uncommitted
- **AND** the surface commits only if a later `tool_start` for the same tool carries real arguments and resolves to a visible label

#### Scenario: No-argument visible tool commits

- **GIVEN** an uncommitted deferred surface
- **AND** a visible tool with no `conditionalHidden` rule (for example `list_repositories`, which takes no arguments)
- **WHEN** its `tool_start` event arrives with an empty arguments object
- **THEN** the surface commits, since no argument value could hide it

#### Scenario: conditionalHidden tool does not commit when its args match the hide rule

- **GIVEN** an uncommitted deferred surface
- **AND** a tool whose `conditionalHidden` rule matches the argument values supplied
- **WHEN** its `tool_start` event arrives with those arguments
- **THEN** the label resolves to null and the surface remains uncommitted

#### Scenario: switch_delivery_context does not commit

- **GIVEN** an uncommitted deferred surface
- **WHEN** a `tool_start` event arrives for `switch_delivery_context` (which is in the `hidden` set)
- **THEN** the surface remains uncommitted
- **AND** the switch itself then proceeds per the delivery-handler switching rules, so no card is opened only to be torn down by the switch

#### Scenario: First visible tool commits and becomes the first row

- **GIVEN** an uncommitted deferred surface
- **WHEN** a `tool_start` event arrives with real arguments and a non-null resolved label
- **THEN** the surface opens with a single append carrying the thinking row and that tool's task in `in_progress` status
- **AND** no separate "Acknowledged" append precedes it
- **AND** the card is never rendered without a visible tool task

### Requirement: Deferral Applies To Proactive Triggers Only

The system SHALL open a turn's progress surface in deferred mode when the turn is started by an incoming message whose trigger type is `autoRespond`, `threadReply`, or `channelReply`. For every other trigger type — `directMessages`, `mentions`, `reactions` — for every button-driven continuation (choice, retry, follow-up), regardless of the continued session's original trigger type, and for a plugin-started thread conversation (`sdk.startThreadConversation`), which borrows the `autoRespond` trigger type while a human is waiting — the surface SHALL open immediately as it does today.

A caller that drives a turn with nobody waiting while using a user-initiated trigger type — the investigation engine's background rounds, which use `mentions` — SHALL request deferral explicitly, so the rule follows whether anyone is waiting rather than the borrowed trigger type.

Because a proactive turn has no waiting requester, deferral SHALL NOT be bounded by an elapsed-time fallback.

#### Scenario: Proactive trigger defers

- **WHEN** a turn is started with trigger type `autoRespond`, `threadReply`, or `channelReply`
- **THEN** its progress surface is opened in deferred mode

#### Scenario: User-initiated trigger does not defer

- **WHEN** a turn is started with trigger type `directMessages`, `mentions`, or `reactions`
- **THEN** its progress surface opens immediately with the "Acknowledged, working on it..." task

#### Scenario: Button continuation does not defer

- **GIVEN** a session originally created by a proactive trigger
- **WHEN** a user clicks a choice, retry, or follow-up button on it
- **THEN** the resulting turn's progress surface opens immediately

#### Scenario: Plugin-started thread conversation does not defer

- **WHEN** a plugin starts a thread conversation via `sdk.startThreadConversation` (e.g. the trivia "Tell me more" button)
- **THEN** the resulting turn's progress surface opens immediately, even though the turn's trigger type is `autoRespond`

#### Scenario: Background investigation rounds defer

- **GIVEN** an open split investigation
- **WHEN** an investigation round is driven with nobody waiting — by a message in a followed origin thread that the classifier sent to `respond`, or by boot reconciliation after downtime
- **THEN** the round's progress surface on the main investigation surface is opened in deferred mode, even though the round uses trigger type `mentions`

#### Scenario: Bootstrap investigation round opens immediately

- **WHEN** a user starts a split investigation and its first round runs
- **THEN** that round's progress surface opens immediately

#### Scenario: Scheduled trigger is never deferred

- **WHEN** a turn is started with trigger type `scheduled`
- **THEN** the scheduler dispatches it with `silentThinking`, so the silent handler is selected and there is no streaming surface to defer
- **AND** were a scheduled turn ever to select the streaming handler, it would fall under "every other trigger type" and open immediately

#### Scenario: No time-based commit

- **GIVEN** an uncommitted deferred surface
- **WHEN** an arbitrary amount of time passes with no committing event
- **THEN** the surface remains uncommitted and posts nothing

### Requirement: An Uncommitted Surface Is Never Stopped Or Flushed

Stopping a chat stream that has not started causes the Slack client to start it, and the streamer's stop path appends a completion task. Therefore, when a deferred surface is uncommitted, `stop()` SHALL be a no-op and SHALL NOT append, start, or finalize a stream. Teardown of an uncommitted surface — whether discarding (skip, cancel, mid-run switch) or freezing (error, safety net) — SHALL make no Slack call on the surface's behalf. This constrains only the progress surface: an error outcome still posts its error message through the orchestrator's own error path, independent of commit state.

#### Scenario: Discarding an uncommitted surface posts nothing

- **GIVEN** a turn with an uncommitted deferred surface
- **WHEN** the turn ends in a skip and the surface is wound down with `discard: true`
- **THEN** no stream is started, no chunk is appended, and no `chat.delete` call is made
- **AND** Slack shows no trace of the turn

#### Scenario: Cancelling an uncommitted surface posts nothing

- **GIVEN** a turn with an uncommitted deferred surface
- **WHEN** the run is cancelled (e.g., via the stop reaction) and the surface is wound down with `discard: true`
- **THEN** no stream is started, no chunk is appended, and no `chat.delete` call is made
- **AND** Slack shows no trace of the turn

#### Scenario: Safety-net teardown of an uncommitted surface posts nothing

- **GIVEN** a turn with an uncommitted deferred surface
- **WHEN** the orchestrator's final teardown calls `windDown()` without `discard`
- **THEN** no stream is started and no chunk is appended

#### Scenario: Error on an uncommitted surface still notifies the user

- **GIVEN** a proactive turn whose deferred surface never committed
- **WHEN** the turn ends in an error
- **THEN** the surface's teardown makes no Slack call
- **AND** the error message is still posted to the thread through the existing error path, exactly as for a non-deferred turn

#### Scenario: Committed surface tears down normally

- **GIVEN** a deferred surface that has committed and opened a card
- **WHEN** the turn ends in a skip and the surface is wound down with `discard: true`
- **THEN** the opened message is removed via `chat.delete` as for a non-deferred surface

### Requirement: Uncommitted Delivery Lands Without A Card

When a turn delivers a response while its deferred surface is still uncommitted, the system SHALL land the response with `chat.postMessage` rather than finalizing the stream in place, and SHALL report the delivery as having notified the user.

#### Scenario: Answer with no visible tool call posts directly

- **GIVEN** a proactive turn whose deferred surface never committed
- **WHEN** Claude delivers a response
- **THEN** the blocks are posted via `chat.postMessage` at the turn's landing target
- **AND** no progress card is ever shown for that turn

#### Scenario: Uncommitted delivery suppresses the redundant ping

- **GIVEN** a turn delivered from an uncommitted deferred surface
- **WHEN** the delivery result is evaluated
- **THEN** it reports `notified: true`
- **AND** the orchestrator does NOT send a follow-up response notification

