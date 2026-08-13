# split-investigations Specification

## Purpose
Enable autonomous investigation sessions that follow multiple threads and compose findings into a central location (channel or DM), with configurable emoji-trigger entry points and lifecycle management tools.

## Requirements

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

When the feature is enabled, the system SHALL register a `reaction_added` handler filtering on the configured investigate emoji. Reacting on a message SHALL resolve the message's thread and invoke the shared bootstrap with the investigations-channel surface. When the reacted thread is already followed by an open investigation, the system SHALL NOT create a second investigation and SHALL send the reactor an ephemeral link to the existing one. On a **successful** start, the system SHALL NOT post any ephemeral confirmation to the reactor; ephemerals SHALL be reserved for the duplicate, unconfigured, cycle, and resolve-failure cases.

#### Scenario: Reaction starts an investigation

- **WHEN** a user reacts with the investigate emoji on a message and an investigations channel is configured
- **THEN** an investigation is bootstrapped in the investigations channel following the reacted thread

#### Scenario: Successful start posts no confirmation ephemeral

- **WHEN** an investigate reaction successfully bootstraps an investigation
- **THEN** the reactor receives no ephemeral confirmation message

#### Scenario: Duplicate reaction links existing investigation

- **WHEN** a user reacts with the investigate emoji on a thread already followed by an open investigation
- **THEN** no new investigation is created
- **AND** the reactor receives an ephemeral message linking the existing investigation thread

### Requirement: Conversational entry points

The system SHALL expose a `start_investigation` tool (all roles, query mode, enabled-gated) accepting a surface (`"channel" | "dm"`), an optional thread reference (defaulting to the current thread), and an optional subject. Claude SHALL use it when a user asks to investigate on the side or to continue the conversation in the investigations channel or in DM. The tool SHALL return promptly after the bootstrap's fast stage — it SHALL NOT block on the first investigation round — and SHALL return the main-thread permalink so Claude can answer with a link. The requester passed to the bootstrap SHALL be the current turn's speaker (per the requester-identity capability), not the session creator. After a successful relocation the origin thread SHALL always receive a visible acknowledgment: Claude's response in the origin thread naming the investigation surface with its permalink. Relocation to DM SHALL follow the origin thread in `follow` mode by default.

#### Scenario: Investigate on the side

- **WHEN** a user in a thread asks Clack to investigate on the side and the channel surface is available
- **THEN** Claude calls `start_investigation` with the current thread
- **AND** replies in the origin thread with the investigation link

#### Scenario: Tool returns before the first round completes

- **WHEN** Claude calls `start_investigation` and the bootstrap's fast stage succeeds
- **THEN** the tool result (with the permalink) is available without waiting for the first investigation round
- **AND** the calling turn retains budget to acknowledge in the origin thread

#### Scenario: Requester is the current speaker on a reused thread

- **WHEN** user B triggers `start_investigation` in a thread whose session was created by user A
- **THEN** the investigation's requester — parent-message attribution, `startedBy`, `addedBy`, session ownership, and the breadcrumb-preference lookup — is user B

#### Scenario: Continue in DM

- **WHEN** a user asks to continue the conversation in DM
- **THEN** an investigation is bootstrapped with a DM surface for the requester
- **AND** the origin thread is added to `followedThreads` with mode `follow`
- **AND** Claude replies in the origin thread acknowledging the move to DM

#### Scenario: DM surface needs no configured channel

- **WHEN** no investigations channel is configured and a user asks to continue in DM
- **THEN** the DM bootstrap proceeds normally


### Requirement: Surface-agnostic bootstrap

All entry points SHALL funnel into one bootstrap that: (1) resolves the main surface — the configured investigations channel or a DM with the requester; (2) posts the main-surface parent message (rendered via `t()`, attributing the requester per the "Requester attribution on the main-surface parent" requirement) and creates a persisted session whose `followedThreads` contains the origin thread; (3) launches a first investigation round over the full origin-thread history **detached** — the bootstrap SHALL return once stages (1)–(2) and the breadcrumb decision complete, without awaiting the round, so callers (tool handlers, reaction handlers) are never blocked on a nested Claude query; a detached-round failure SHALL be logged and SHALL NOT affect the bootstrap result; (4) posts a single breadcrumb reply in the origin thread linking the main surface, rendered via `t()`, ONLY when the requester's breadcrumb-visibility preference is "explicit" (see the user-preferences capability); when the preference is "silent" (the default) no breadcrumb is posted. Whether or not a breadcrumb is posted, the system SHALL NOT post any further messages to followed threads.

Before completing, the bootstrap SHALL ensure it can receive live events for a channel-surface origin without assuming `conversations.join` is required. It SHALL first detect existing membership via `conversations.info` (`is_member`), which needs only the already-granted read scopes: when the bot is already a member — or the origin is a DM/MPIM (`is_im`/`is_mpim`, where the bot is inherently a participant) — no join is attempted and the follow stays interactive. Only when the bot is genuinely absent from a public channel SHALL the bootstrap attempt `conversations.join`; a failure there (including `missing_scope` for `channels:join`) SHALL degrade the followed thread to `follow` mode and notify the owner with a message naming the actual cause (the missing `channels:join` scope / app reinstall) rather than implying the channel could not be found.

#### Scenario: Immediate first round

- **WHEN** an investigation is bootstrapped
- **THEN** a first round is launched without waiting for further activity
- **AND** it has access to the full history of the origin thread
- **AND** its findings are posted to the main thread once it completes (after the bootstrap has returned)

#### Scenario: Bootstrap returns without awaiting the first round

- **WHEN** an investigation is bootstrapped from any entry point
- **THEN** the bootstrap returns its result (status, sessionId, permalink) after the parent post, session creation, and breadcrumb decision
- **AND** the caller is not blocked on the first round's nested Claude query

#### Scenario: Detached first-round failure does not fail the bootstrap

- **WHEN** the detached first round throws after the bootstrap returned
- **THEN** the failure is logged
- **AND** the investigation session, index entry, and parent message remain intact

#### Scenario: Breadcrumb posted only when explicit

- **WHEN** the bootstrap completes and the requester's breadcrumb-visibility preference is "explicit"
- **THEN** exactly one breadcrumb reply exists in the origin thread
- **AND** no subsequent investigation activity posts to the origin thread

#### Scenario: Silent start posts no breadcrumb

- **WHEN** the bootstrap completes and the requester's breadcrumb-visibility preference is "silent" (the default)
- **THEN** no breadcrumb reply is posted in the origin thread
- **AND** no subsequent investigation activity posts to the origin thread

#### Scenario: Origin channel the bot is already in needs no join

- **WHEN** the origin thread is in a channel where `conversations.info` reports `is_member: true`
- **THEN** the bootstrap attempts no `conversations.join`
- **AND** the followed thread stays in `followAndInteract` mode
- **AND** no owner degrade notification is sent

#### Scenario: DM/MPIM origin needs no join

- **WHEN** the origin is a DM or MPIM (`is_im`/`is_mpim`)
- **THEN** the bootstrap attempts no `conversations.join` and does not degrade

#### Scenario: Genuinely-absent public channel join fails

- **WHEN** the origin is a public channel the bot is not a member of AND `conversations.join` fails (e.g. `missing_scope` for `channels:join`)
- **THEN** the followed thread degrades to `follow` mode
- **AND** the owner is notified with a message naming the missing `channels:join` scope / reinstall as the cause

#### Scenario: Membership detection fails

- **WHEN** `conversations.info` throws or returns without confirming `is_member` for a channel-surface origin
- **THEN** the bootstrap treats membership as unconfirmed and falls through to the `conversations.join` attempt, preserving the degrade-on-failure safety net


### Requirement: Requester attribution on the main-surface parent

The main-surface parent message SHALL name the investigation's requester in the form `🔎 {requester} requested an investigation of: {link}`, for both the channel and DM surfaces. The rendering of `{requester}` SHALL follow the requester's "investigation requester-tag" preference (see the user-preferences capability): when the preference is OFF (the default) the requester SHALL be rendered as a plain-text display name (`@Name`) that does NOT trigger a Slack notification; when ON the requester SHALL be rendered as a real `<@userId>` mention that pings them. Display-name resolution SHALL reuse the existing user-cache helper, which always yields a non-empty string (falling back to username, then the user ID, when no display name is available).

#### Scenario: Tag preference off renders a non-pinging name

- **WHEN** the requester's investigation requester-tag preference is OFF and an investigation is bootstrapped
- **THEN** the parent message reads `🔎 @<displayName> requested an investigation of: {link}` as plain text
- **AND** the requester is not pinged

#### Scenario: Tag preference on renders a real mention

- **WHEN** the requester's investigation requester-tag preference is ON and an investigation is bootstrapped
- **THEN** the parent message reads `🔎 <@userId> requested an investigation of: {link}`
- **AND** the requester receives a Slack mention notification

#### Scenario: Attribution applies to both surfaces

- **WHEN** an investigation is bootstrapped on either the channel or DM surface
- **THEN** the parent message uses the requester-attributed form for that surface

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

### Requirement: Origin disengagement on current-thread relocation

When `start_investigation` relocates the CURRENT thread — no thread reference given, or the reference equals the calling session's channel and thread — and the bootstrap succeeds, the system SHALL set the calling session's attention level to `off` so Clack stops auto-responding in the origin thread. The origin thread SHALL remain a followed read-only source for the investigation regardless of the origin session's attention level. Relocating a DIFFERENT thread SHALL NOT change the calling session's attention level. Re-engagement follows the existing attention-level rules (e.g. an @mention re-engages).

#### Scenario: Relocating the current thread disengages it

- **WHEN** a user in an engaged thread asks Clack to take the investigation elsewhere and `start_investigation` succeeds for that same thread
- **THEN** the calling session's attention level is set to `off`
- **AND** subsequent passive messages in the origin thread trigger no auto-respond

#### Scenario: Followed source keeps feeding the investigation after disengage

- **WHEN** the origin session is disengaged by relocation and a new message lands in the origin thread
- **THEN** the message still reaches the investigation via the followed-thread tee

#### Scenario: Investigating a different thread does not disengage the current one

- **WHEN** a user asks Clack to investigate a different thread (an explicit `thread_ref` not equal to the current session's thread)
- **THEN** the calling session's attention level is unchanged

#### Scenario: Failed bootstrap leaves attention unchanged

- **WHEN** `start_investigation` targets the current thread but the bootstrap does not return ok (unconfigured channel, duplicate, cycle, or DM failure)
- **THEN** the calling session's attention level is unchanged

### Requirement: Followed-thread write guard

The system SHALL enforce the followed-threads-are-inputs rule structurally, not only by prompt. `submit_response` validation SHALL reject any `post_to` action — automatic (`auto: true`) or staged as a button — whose target `(channel, thread_ts)` matches a followed thread of the current session, with an error naming followed threads as read-only sources. The ONLY exception SHALL be a `user_requested: true` field on the `post_to` action, documented as settable exclusively when the requester explicitly asked, in the investigation thread, to post back to the source thread. A `post_to` targeting the origin channel WITHOUT a `thread_ts` (or a different thread in it) SHALL NOT be blocked. The blocked-thread set SHALL be read from the live session's `followedThreads` so threads followed mid-session are covered. The investigation delivery context SHALL NOT carry guidance that invites posting back to source threads; its read-only directive SHALL state the explicit-request exception so prompt and validation agree.

#### Scenario: Auto post to a followed thread is rejected

- **WHEN** an investigation session's `submit_response` includes a `post_to` with `auto: true` targeting a followed thread and no `user_requested` marker
- **THEN** validation fails with an error naming the followed-thread read-only rule
- **AND** nothing is posted to the followed thread

#### Scenario: Staged share button to a followed thread is rejected

- **WHEN** an investigation session's `submit_response` stages a non-auto `post_to` button targeting a followed thread and no `user_requested` marker
- **THEN** validation fails the same way
- **AND** no share button for that target is rendered

#### Scenario: Explicit user request permits the share

- **WHEN** the requester explicitly asks, in the investigation thread, to post findings back to the source thread AND Claude includes `user_requested: true` on the `post_to`
- **THEN** the post is permitted

#### Scenario: Origin channel outside the followed thread is not blocked

- **WHEN** a `post_to` targets the followed thread's channel without a `thread_ts`, or a different thread in that channel
- **THEN** the guard does not reject it

#### Scenario: Thread followed mid-session is covered

- **WHEN** `follow_thread` adds a new followed thread and a later `submit_response` targets it with `post_to`
- **THEN** the guard rejects it like any bootstrap-time followed thread
