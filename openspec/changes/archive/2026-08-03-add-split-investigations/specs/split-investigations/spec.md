# split-investigations Specification

## ADDED Requirements

### Requirement: Feature gating and configuration

The system SHALL gate the entire split-investigations feature behind a top-level `config.investigations` block (`{ enabled: boolean, emoji?: string }`, fail-fast zod, `emoji` defaulting to `"mag"`). When the block is absent or `enabled` is `false`, the feature SHALL be fully inert: no reaction handler registered, no investigation tools in any tool schema, no followed-thread event routing, and no manifest scope additions. The investigate emoji SHALL be read from `config.investigations.emoji`, not from `config.reactions`.

#### Scenario: Disabled feature is observably absent

- **WHEN** `config.investigations` is absent or `enabled: false`
- **THEN** reacting with the investigate emoji does nothing
- **AND** `start_investigation` / `follow_thread` / `unfollow_thread` / `list_followed_threads` / `close_investigation` are not present in any tool schema
- **AND** the generated manifest is byte-identical to one generated without the feature

#### Scenario: Invalid config fails boot

- **WHEN** `config.investigations` is present but malformed (e.g. `enabled` not a boolean)
- **THEN** boot fails with a formatted zod error naming the field

### Requirement: Investigations state file

The system SHALL persist the investigations channel and the open-investigations index in `data/state/investigations.json` (`{ channel: string | null, open: Record<"<channel>:<threadTs>", OpenInvestigation> }`), parsed with a graceful zod reader: on mismatch it SHALL log and return the default (`{ channel: null, open: {} }`), never wiping real state. All mutations SHALL flow through a single writer module that persists to disk and then updates the in-memory index.

#### Scenario: Missing or corrupt state file

- **WHEN** the state file is absent or fails to parse
- **THEN** the system operates with `channel: null` and an empty index
- **AND** the on-disk file is not overwritten until the next legitimate write

#### Scenario: Index survives restart

- **WHEN** an investigation is open and the process restarts
- **THEN** the index is reloaded from disk and followed-thread events for it are routed again

### Requirement: Investigate reaction entry point

When the feature is enabled, the system SHALL register a `reaction_added` handler filtering on the configured investigate emoji. Reacting on a message SHALL resolve the message's thread and invoke the shared bootstrap with the investigations-channel surface. When the reacted thread is already followed by an open investigation, the system SHALL NOT create a second investigation and SHALL send the reactor an ephemeral link to the existing one.

#### Scenario: Reaction starts an investigation

- **WHEN** a user reacts with the investigate emoji on a message and an investigations channel is configured
- **THEN** an investigation is bootstrapped in the investigations channel following the reacted thread

#### Scenario: Duplicate reaction links existing investigation

- **WHEN** a user reacts with the investigate emoji on a thread already followed by an open investigation
- **THEN** no new investigation is created
- **AND** the reactor receives an ephemeral message linking the existing investigation thread

### Requirement: Conversational entry points

The system SHALL expose a `start_investigation` tool (all roles, query mode, enabled-gated) accepting a surface (`"channel" | "dm"`), an optional thread reference (defaulting to the current thread), and an optional subject. Claude SHALL use it when a user asks to investigate on the side or to continue the conversation in the investigations channel or in DM. The tool SHALL return the main-thread permalink so Claude can answer with a link. Relocation to DM SHALL follow the origin thread in `follow` mode by default.

#### Scenario: Investigate on the side

- **WHEN** a user in a thread asks Clack to investigate on the side and the channel surface is available
- **THEN** Claude calls `start_investigation` with the current thread
- **AND** replies in the origin thread with the investigation link

#### Scenario: Continue in DM

- **WHEN** a user asks to continue the conversation in DM
- **THEN** an investigation is bootstrapped with a DM surface for the requester
- **AND** the origin thread is added to `followedThreads` with mode `follow`

#### Scenario: DM surface needs no configured channel

- **WHEN** no investigations channel is configured and a user asks to continue in DM
- **THEN** the DM bootstrap proceeds normally

### Requirement: Surface-agnostic bootstrap

All entry points SHALL funnel into one bootstrap that: (1) resolves the main surface — the configured investigations channel or a DM with the requester; (2) posts the main-surface parent message and creates a persisted session whose `followedThreads` contains the origin thread; (3) immediately runs a first investigation round over the full origin-thread history; (4) posts a single breadcrumb reply in the origin thread linking the main surface, rendered via `t()`. After the breadcrumb, the system SHALL NOT post to followed threads.

#### Scenario: Immediate first round

- **WHEN** an investigation is bootstrapped
- **THEN** a first round runs without waiting for further activity
- **AND** it has access to the full history of the origin thread
- **AND** its findings are posted to the main thread

#### Scenario: Breadcrumb is one-time

- **WHEN** the bootstrap completes
- **THEN** exactly one breadcrumb reply exists in the origin thread
- **AND** no subsequent investigation activity posts to the origin thread

#### Scenario: Public side channel auto-join

- **WHEN** the origin thread is in a public channel the bot is not a member of
- **THEN** the bootstrap joins the channel before completing
- **AND** if joining fails, the followed thread degrades to `follow` mode and the owner is notified

### Requirement: Owner escalation when unconfigured

When the feature is enabled but no investigations channel is set, an investigate reaction SHALL trigger a DM to the workspace owner stating that investigate mode was used without a configured channel, linking the Home Tab Investigations section; the reactor SHALL receive an ephemeral notice. On the conversational path, `start_investigation` with `surface: "channel"` and no channel configured SHALL NOT bootstrap; it SHALL return a result carrying an explicit `channelNotConfigured` signal so Claude tells the requester directly that the channel is not configured (and DMs the owner as above).

#### Scenario: Reaction with no channel configured

- **WHEN** a user reacts with the investigate emoji and `channel` is null in state
- **THEN** the owner receives a DM naming the reactor and linking the Home Tab section
- **AND** no investigation is created
- **AND** the reactor receives an ephemeral notice

#### Scenario: Conversational channel request with no channel configured

- **WHEN** Claude calls `start_investigation` with `surface: "channel"` and `channel` is null in state
- **THEN** the tool returns a `channelNotConfigured` signal and no investigation is created
- **AND** Claude tells the requester the channel is not configured
- **AND** the owner receives the same unconfigured DM

### Requirement: Followed threads and modes

An open investigation SHALL support following multiple threads, each with mode `follow` or `followAndInteract`, a `lastInjectedTs` cursor, and a `pendingCount`. In `followAndInteract`, each new human side-thread message SHALL run a single-turn pre-analysis classifier keyed to the investigation subject (verdicts `respond | skip`, no cap or debounce): the classifier examines the new message against the investigation subject and returns `respond` when it carries new information worth a round, or `skip` when it is noise/off-topic. A `respond` verdict SHALL drive an investigation round. In `follow`, no classifier and no Claude invocation SHALL occur — the message SHALL only increment `pendingCount`, surfaced the next time the main session runs for any other reason.

#### Scenario: followAndInteract fires a round

- **WHEN** a human posts new information in a `followAndInteract` thread and the classifier returns `respond`
- **THEN** a round runs on the main session with the drained delta injected
- **AND** the round's output is posted to the main thread only

#### Scenario: followAndInteract skip

- **WHEN** the classifier returns `skip`
- **THEN** no Claude round runs
- **AND** the message remains undrained (picked up by the next round)

#### Scenario: follow mode is purely piggyback

- **WHEN** messages arrive in a `follow`-mode thread
- **THEN** only `pendingCount` is updated, with no classifier or Claude call
- **AND** the next main-session round (triggered by anything else) surfaces the pending count and drained content

### Requirement: Event routing and coexistence

When the feature is enabled, the message-event pipeline SHALL match incoming messages against the open-investigations index by `(channel, threadTs)` in O(1) and tee matching events to the follow pipeline. This routing SHALL NOT suppress, reorder, or replace existing handling — auto-respond, mentions, and every other consumer of the event SHALL behave exactly as without the feature. Bot messages (identified by a present `bot_id` or `subtype: "bot_message"`, including Clack's own breadcrumb) SHALL never count as deltas.

#### Scenario: Followed thread that is also auto-respond engaged

- **WHEN** a message arrives in a thread that is both followed and auto-respond engaged
- **THEN** the auto-respond path evaluates and replies in the side thread as today
- **AND** the follow pipeline independently processes the same event for the investigation

#### Scenario: Bot messages ignored

- **WHEN** Clack posts in a followed thread (e.g. via auto-respond)
- **THEN** the follow pipeline ignores the event (no classifier, no pendingCount change)

### Requirement: Lossless cursors — drain on round

Every investigation round, regardless of trigger, SHALL first drain each followed thread's messages newer than its `lastInjectedTs` via `conversations.replies`, inject them (attributed and timestamped) into the round's context, and advance the cursors only for content actually injected. Events are triggers only; content acquisition is always the drain. On boot, a delayed reconciliation pass — fired after `cron.catchUp.delayMinutes` (matching the cron catch-up delay) — SHALL sweep open investigations once and run the classifier for any `followAndInteract` thread with undrained messages, isolating failures per investigation.

#### Scenario: Messages during downtime are not lost

- **WHEN** messages arrive in a followed thread while the process is down
- **THEN** the next round (or the boot reconciliation pass, for `followAndInteract`) drains and injects them
- **AND** no side-thread message is ever permanently skipped

#### Scenario: Rapid messages batch into one round

- **WHEN** several side-thread messages arrive while a round is in flight
- **THEN** the in-flight round's drain picks up those visible before its fetch and the remainder is drained by the next round
- **AND** no additional concurrent round is started for the same investigation

### Requirement: Lifecycle tools

The system SHALL expose `follow_thread` (add a thread to the current investigation with a mode), `unfollow_thread`, `list_followed_threads`, and `close_investigation` on investigation-session tool schemas (all roles, enabled-gated). `follow_thread` SHALL reject threads located in the investigations channel (cycle guard) and threads already followed by this investigation. `close_investigation` SHALL remove the investigation from the open index, immediately stopping event routing; the session and its history remain on disk.

#### Scenario: Following an additional thread

- **WHEN** Claude calls `follow_thread` with a new thread and mode during an investigation
- **THEN** the thread is added to `followedThreads` with `lastInjectedTs` at `0` so the next round drains its full history
- **AND** its content becomes available to subsequent rounds

#### Scenario: Duplicate thread rejected

- **WHEN** `follow_thread` targets a thread already in `followedThreads` for this investigation
- **THEN** the tool returns an error naming the thread as already followed
- **AND** no duplicate entry is created

#### Scenario: Cycle guard

- **WHEN** `follow_thread` targets a thread inside the investigations channel
- **THEN** the tool returns an error and no follow is added

#### Scenario: Closing an investigation

- **WHEN** `close_investigation` is called (or the Home Tab Close button is used)
- **THEN** the entry is removed from the open index and persisted
- **AND** subsequent events in its followed threads are not routed to the follow pipeline
