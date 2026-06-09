## ADDED Requirements

### Requirement: Shared Message-Payload Entity

The system SHALL define ONE message-payload entity describing "a Slack message Claude can deliver," reused across every delivery surface rather than duplicated per surface. The entity's fields SHALL be:

- `blocks` (REQUIRED, non-empty array) — Block Kit content.
- `thread_replies` (optional) — threaded replies posted under this message.
- `actions` (optional) — interactive actions/buttons attached to this message.
- `suppress_unfurls` (optional) — disable link/image previews for this message.
- `reactions` (optional) — emoji reactions to add to this message.

This entity SHALL be referenced by: the normal bound-channel primary, each `post_to` action, and each `deliver_to` entry's `response`. The entity SHALL NOT include routing/terminator fields (`channel`, `thread_ts`, `skip_response`, `deliver_to`, `additional_messages`) — those belong to the surface that wraps the payload.

#### Scenario: One definition reused by all delivery surfaces

- **WHEN** the message-content shape is needed by the primary, a `post_to` action, or a `deliver_to` entry
- **THEN** all three reference the same payload definition (no per-surface re-declaration of `blocks` / `thread_replies` / `actions` / `suppress_unfurls` / `reactions`)

#### Scenario: Payload excludes routing fields

- **WHEN** the shared payload schema is assembled
- **THEN** it does NOT contain `channel`, `thread_ts`, `skip_response`, or `deliver_to`

### Requirement: Shared Per-Channel Delivery Routine

The system SHALL provide ONE per-channel delivery routine that delivers a message-payload to a given `(channel, thread_ts?)`, reused (rather than duplicated) by `post_to` actions and `deliver_to` entries. The routine SHALL post the payload's `blocks` (honoring `suppress_unfurls`), add its `reactions`, post its `thread_replies` under the message, and return the posted message's Slack timestamp. If the Slack API call fails, the routine SHALL surface the error to its caller (rather than returning silently) so the caller can record the run as an error.

The interactive bound-channel primary is delivered through a SEPARATE streamer-based adapter, NOT this routine: the streamer replaces the in-thread "thinking…" card via an in-place `chat.update`, which `chat.postMessage` cannot reproduce without orphaning the card and losing `postTopLevel` / follow-up-session / notification behavior. The primary therefore shares only the message-payload ENTITY (the schema/type above), not the delivery routine. Channelless runs have no primary; their sole delivery surface is `deliver_to`, which uses the shared routine.

#### Scenario: Delivery routine surfaces Slack failures

- **WHEN** the underlying Slack post fails (e.g. `channel_not_found`)
- **THEN** the routine surfaces the error to its caller instead of returning a success/empty ts

#### Scenario: post_to and deliver_to share the delivery code path

- **WHEN** a `post_to` action and a `deliver_to` entry are each delivered
- **THEN** both go through the same per-channel delivery routine (only the target `channel`/`thread_ts` differs)

#### Scenario: Delivery routine returns the posted ts

- **WHEN** the routine delivers a payload to a channel
- **THEN** it returns the Slack `ts` of the posted top-level message
