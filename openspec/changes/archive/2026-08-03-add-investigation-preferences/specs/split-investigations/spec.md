## MODIFIED Requirements

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

### Requirement: Surface-agnostic bootstrap

All entry points SHALL funnel into one bootstrap that: (1) resolves the main surface — the configured investigations channel or a DM with the requester; (2) posts the main-surface parent message (rendered via `t()`, attributing the requester per the "Requester attribution on the main-surface parent" requirement) and creates a persisted session whose `followedThreads` contains the origin thread; (3) immediately runs a first investigation round over the full origin-thread history; (4) posts a single breadcrumb reply in the origin thread linking the main surface, rendered via `t()`, ONLY when the requester's breadcrumb-visibility preference is "explicit" (see the user-preferences capability); when the preference is "silent" (the default) no breadcrumb is posted. Whether or not a breadcrumb is posted, the system SHALL NOT post any further messages to followed threads.

Before completing, the bootstrap SHALL ensure it can receive live events for a channel-surface origin without assuming `conversations.join` is required. It SHALL first detect existing membership via `conversations.info` (`is_member`), which needs only the already-granted read scopes: when the bot is already a member — or the origin is a DM/MPIM (`is_im`/`is_mpim`, where the bot is inherently a participant) — no join is attempted and the follow stays interactive. Only when the bot is genuinely absent from a public channel SHALL the bootstrap attempt `conversations.join`; a failure there (including `missing_scope` for `channels:join`) SHALL degrade the followed thread to `follow` mode and notify the owner with a message naming the actual cause (the missing `channels:join` scope / app reinstall) rather than implying the channel could not be found.

#### Scenario: Immediate first round

- **WHEN** an investigation is bootstrapped
- **THEN** a first round runs without waiting for further activity
- **AND** it has access to the full history of the origin thread
- **AND** its findings are posted to the main thread

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

## ADDED Requirements

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
