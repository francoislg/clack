## MODIFIED Requirements

### Requirement: Atomic Slot Claim

The "consult registry then spawn fresh" decision used by Slack handlers SHALL be atomic enough that two concurrent invocations cannot both spawn a fresh run for the same `(channelId, threadTs)`. Atomicity SHALL NOT depend on construction-time set-if-absent semantics that the handler reaches only after awaited setup work (session lookup, delivery/streamer setup, Claude option building). Because the registry consult and the slot claim are separated by such awaited work, the handler SHALL serialize the entire consult-then-`{sendUpdate | spawn}` decision per `(channelId, threadTs)` (e.g. under a per-thread lock) so that a second invocation for the same key cannot observe an empty slot while the first invocation is still between its consult and its claim. The per-thread serialization SHALL be held at least until the freshly spawned run has registered its handle, and SHALL be released without waiting for the run to complete.

#### Scenario: Two concurrent triggers — one spawn, one sendUpdate

- **WHEN** two Slack handler invocations execute concurrently for the same `(channelId, threadTs)` with no existing run
- **THEN** at most one of them constructs a new `ClaudeRunHandle`
- **AND** the other invocation observes the registered handle on its lookup and calls `handle.sendUpdate(text)` instead of constructing a second run

#### Scenario: Second trigger arrives during the first's async setup

- **WHEN** a first invocation for `(channelId, threadTs)` has consulted the registry (found it empty) but has not yet registered its run because it is still awaiting setup (session lookup, streamer start, option building)
- **AND** a second invocation for the same key arrives during that window
- **THEN** the second invocation does NOT observe an empty slot and spawn a parallel run
- **AND** it instead waits for the first invocation's decision and routes its text to the resulting run via `sendUpdate` (or falls through to a fresh spawn only after the first run has settled)
- **AND** at most one "thinking"/streamer surface is created for the thread

#### Scenario: SendUpdate races with handle settling

- **WHEN** a Slack handler observes a registered handle and invokes `handle.sendUpdate(text)`
- **AND** the handle settles (deregisters) concurrently
- **THEN** `sendUpdate` may resolve successfully (delivered to the SDK before settle) OR reject with "run already settled"
- **AND** if `sendUpdate` rejects, the handler spawns a fresh run for the now-empty slot

## ADDED Requirements

### Requirement: No Untracked Duplicate Runs

A freshly constructed run that cannot claim its `(channelId, threadTs)` slot because the slot is already occupied SHALL NOT proceed to execute as an untracked duplicate. The construction/spawn SHALL instead abort (and the triggering message be routed to the owning run), so that every executing run is registered in the active-runs registry and therefore reachable by the stop pipeline. Logging the collision and proceeding without registration is NOT permitted.

#### Scenario: Slot already occupied at claim time

- **WHEN** a run attempts to register itself for `(channelId, threadTs)` and the slot is already held by another run
- **THEN** the attempting run does NOT continue executing untracked
- **AND** it aborts its construction, and its triggering message is routed to the owning run (via `sendUpdate`) or dropped through the normal fall-through path
- **AND** no orphaned streamer/"thinking" surface is left open for the aborted run

### Requirement: Slot Ownership Precedes Delivery Setup

A Slack handler invocation SHALL NOT create a streamer or perform fresh delivery setup for a thread until it owns the active-runs slot for that thread (or has decided to route its text into an existing run). This prevents a race-loser from posting a "thinking" indicator for a run that will never be the registered owner.

#### Scenario: Streamer is not started by a race-loser

- **WHEN** an invocation for `(channelId, threadTs)` determines (under per-thread serialization) that a run already exists or will be spawned by another invocation
- **THEN** it does NOT call `streamer.start()` for a new parallel run
- **AND** it routes its text to the owning run via `sendUpdate` instead
