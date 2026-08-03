# delivery-context Delta

## ADDED Requirements

### Requirement: Investigation surface delivery context

When a session is an open investigation, the delivery context passed to Claude SHALL describe the investigation surface: that responses post to the main investigation thread (in the investigations channel or the requester's DM), that followed threads are read-only sources which MUST NOT be posted to, and which followed threads exist with their modes and pending counts. The lifecycle tools (`follow_thread`, `unfollow_thread`, `list_followed_threads`, `close_investigation`) SHALL be named as available actions.

#### Scenario: Channel-surface investigation context

- **WHEN** a round runs on an investigations-channel session
- **THEN** the delivery context states the main thread is the write surface and enumerates followed threads with modes

#### Scenario: DM-surface investigation context

- **WHEN** a round runs on a DM-surface investigation
- **THEN** the delivery context describes DM delivery and the followed origin thread
- **AND** states that followed threads are read-only

#### Scenario: Pending counts surfaced

- **WHEN** a `follow`-mode thread has `pendingCount > 0` at round start
- **THEN** the context includes the count and a hint that the drained messages are available to read
