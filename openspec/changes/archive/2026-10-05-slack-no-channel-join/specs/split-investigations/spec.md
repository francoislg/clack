## MODIFIED Requirements

### Requirement: Investigate reaction entry point

When the feature is enabled, the system SHALL register a `reaction_added` handler filtering on the configured investigate emoji. Reacting on a message SHALL resolve the message's thread and invoke the shared bootstrap with the investigations-channel surface. When the reacted thread is already followed by an open investigation, the system SHALL NOT create a second investigation and SHALL send the reactor an ephemeral link to the existing one. On a **successful** start, the system SHALL NOT post any ephemeral confirmation to the reactor; ephemerals SHALL be reserved for the duplicate, unconfigured, cycle, not-in-channel, and resolve-failure cases.

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

### Requirement: Surface-agnostic bootstrap

All entry points SHALL funnel into one bootstrap that: (1) resolves the main surface — the configured investigations channel or a DM with the requester; (2) posts the main-surface parent message (rendered via `t()`, attributing the requester per the "Requester attribution on the main-surface parent" requirement) and creates a persisted session whose `followedThreads` contains the origin thread; (3) launches a first investigation round over the full origin-thread history **detached** — the bootstrap SHALL return once stages (1)–(2) and the breadcrumb decision complete, without awaiting the round, so callers (tool handlers, reaction handlers) are never blocked on a nested Claude query; a detached-round failure SHALL be logged and SHALL NOT affect the bootstrap result; (4) posts a single breadcrumb reply in the origin thread linking the main surface, rendered via `t()`, ONLY when the requester's breadcrumb-visibility preference is "explicit" (see the user-preferences capability); when the preference is "silent" (the default) no breadcrumb is posted. Whether or not a breadcrumb is posted, the system SHALL NOT post any further messages to followed threads.

The system SHALL NEVER join a channel on its own: no code path SHALL call `conversations.join`. Before stage (2), whichever main surface was requested (`channel` or `dm`), the bootstrap SHALL confirm via `conversations.info` that the bot is a member of the origin conversation (`is_member`), or that the origin is a DM/MPIM (`is_im`/`is_mpim`). When the bot is not a member, or membership cannot be confirmed (the lookup throws, fails, or returns an unexpected shape), the bootstrap SHALL return a `not_in_channel` status without posting the parent message, creating a session, indexing the investigation, or posting a breadcrumb. Each entry point SHALL tell the requester that the bot cannot proceed because it is not in that channel and must be invited first: the reaction entry point via an ephemeral message rendered with `t()`, the `start_investigation` tool via an English error result.

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

#### Scenario: Origin channel the bot is already in

- **WHEN** the origin thread is in a channel where `conversations.info` reports `is_member: true`
- **THEN** the bootstrap proceeds and the followed thread uses the requested mode

#### Scenario: DM/MPIM origin

- **WHEN** the origin is a DM or MPIM (`is_im`/`is_mpim`)
- **THEN** the bootstrap proceeds and the followed thread uses the requested mode

#### Scenario: Existing investigation of a thread the bot can no longer see

- **WHEN** an open investigation already follows the origin thread AND `conversations.info` reports `is_member: false` for its channel
- **THEN** the bootstrap returns `duplicate` with the existing investigation's link, not `not_in_channel`

#### Scenario: Channel the bot is not in

- **WHEN** the origin is a channel where `conversations.info` reports `is_member: false`, for either main surface
- **THEN** the bootstrap returns `not_in_channel`
- **AND** `conversations.join` is not called
- **AND** no parent message, session, investigation index entry, or breadcrumb is created

#### Scenario: Membership cannot be confirmed

- **WHEN** `conversations.info` throws, resolves with `ok: false`, or returns an unexpected shape for the origin
- **THEN** the bootstrap returns `not_in_channel` and `conversations.join` is not called

#### Scenario: DM relocation from a channel the bot is not in

- **WHEN** `start_investigation` is called with `surface: "dm"` and the origin thread is in a channel where `conversations.info` reports `is_member: false`
- **THEN** the bootstrap returns `not_in_channel` and no DM parent message or session is created

#### Scenario: Reaction requester is told

- **WHEN** the reaction entry point receives a `not_in_channel` result
- **THEN** the reactor receives an ephemeral message, rendered via `t()`, saying the bot is not in that channel and must be invited first

#### Scenario: start_investigation requester is told

- **WHEN** `start_investigation` receives a `not_in_channel` result
- **THEN** the tool returns an English error result saying the bot is not in that channel and must be invited first

### Requirement: Lifecycle tools

The system SHALL expose `follow_thread` (add a thread to the current investigation with a mode), `unfollow_thread`, `list_followed_threads`, and `close_investigation` on investigation-session tool schemas (all roles, enabled-gated). `follow_thread` SHALL reject threads located in the investigations channel (cycle guard), threads already followed by this investigation, and threads in a channel the bot is not a member of (or whose membership cannot be confirmed via `conversations.info`; DMs and MPIMs count as joined) — the latter with an English error result saying the bot is not in that channel and must be invited first, and without calling `conversations.join`. `close_investigation` SHALL remove the investigation from the open index, immediately stopping event routing; the session and its history remain on disk.

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

#### Scenario: Following a thread in a DM or MPIM

- **WHEN** `follow_thread` targets a thread where `conversations.info` reports `is_im` or `is_mpim`
- **THEN** the thread is added without a membership refusal

#### Scenario: Thread in a channel the bot is not in

- **WHEN** `follow_thread` targets a thread in a channel where `conversations.info` reports `is_member: false`, or the lookup fails
- **THEN** the tool returns an error saying the bot is not in that channel and must be invited first
- **AND** no follow is added and `conversations.join` is not called

#### Scenario: Closing an investigation

- **WHEN** `close_investigation` is called (or the Home Tab Close button is used)
- **THEN** the entry is removed from the open index and persisted
- **AND** subsequent events in its followed threads are not routed to the follow pipeline
