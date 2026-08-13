# split-investigations Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
