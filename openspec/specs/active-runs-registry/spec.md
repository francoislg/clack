# active-runs-registry

## Purpose

In-memory registry of in-flight `ClaudeRunHandle`s, keyed by `(channelId, threadTs)` and (for direct messages) `(channelId, dmUserId)`. Single source of truth for "is a Claude run active for this conversation?" — used by every Slack handler to decide whether to spawn a fresh run or push a follow-up onto an existing one.
## Requirements
### Requirement: Active-Runs Registry

The system SHALL maintain an in-memory registry of active `ClaudeRunHandle`s. Each handle is registered under one or more lookup keys: a thread key `(channelId, threadTs)` for threaded conversations and, additionally for direct messages, a per-user DM key `(channelId, dmUserId)`. The registry SHALL hold at most one handle per key. The registry replaces the prior `(channelId, messageTs)`-keyed in-flight request registry as the single source of truth for "is a Claude run active for this conversation?"

The DM key exists because each new top-level DM message has its own `messageTs`, so the thread key never matches a previous run in the same DM channel. The DM key gives DMs a stable per-(channel, user) lookup so follow-up messages can find the active run.

#### Scenario: At most one handle per registered key

- **WHEN** a caller attempts to register a `ClaudeRunHandle` for any key already present
- **THEN** the registration is rejected (the caller is responsible for consulting the registry first)

#### Scenario: Lookup by channel and thread

- **WHEN** a caller requests the active run for `(channelId, threadTs)`
- **THEN** the registry returns the registered `ClaudeRunHandle` if present
- **AND** returns `undefined` if absent

#### Scenario: Lookup by DM (channel + user)

- **WHEN** a caller requests the active run for `(channelId, userId)` via the DM-key lookup
- **AND** a handle was registered with `dmUserId = userId` for that channel
- **THEN** the registry returns the handle
- **AND** returns `undefined` if no DM-keyed handle exists for the pair

#### Scenario: Combined lookup with DM fallback

- **WHEN** a caller invokes `getForChannelMessage(channelId, threadTs, userId)`
- **THEN** the registry tries the thread key first
- **AND** if no thread match and `channelId` starts with `D` (Slack DM channel prefix) and `userId` is supplied, falls back to the DM key
- **AND** returns the first match, or `undefined`

#### Scenario: Top-level message uses messageTs as threadTs

- **WHEN** a Slack triggering message has no `thread_ts` (it is not a reply)
- **THEN** registry operations for that run use `threadTs = messageTs`
- **AND** lookups by either form return the same handle

### Requirement: Self-Registration and Self-Deregistration

A `ClaudeRunHandle` SHALL register itself in the active-runs registry on construction and deregister itself on settlement (success, error, or stop).

#### Scenario: Handle registers on construction

- **WHEN** a `ClaudeRunHandle` is constructed with a `(channelId, threadTs)` slot identity
- **THEN** the handle inserts itself into the registry under that key
- **AND** if the slot is already occupied, the construction fails before any SDK Query is started

#### Scenario: Handle deregisters on settle

- **WHEN** the handle's `status` flips to `"settled"`
- **THEN** the handle removes itself from the registry
- **AND** subsequent lookups for the same key return `undefined`

#### Scenario: Handle deregisters on stop

- **WHEN** the handle's `status` flips to `"stopped"`
- **THEN** the handle removes itself from the registry

#### Scenario: Handle deregisters on consumer crash

- **WHEN** the consuming for-await loop throws an error before the handle settles normally
- **THEN** the handle's `try/finally` cleanup deregisters it from the registry
- **AND** any in-flight `SDKUserMessage` queue is discarded

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

### Requirement: Handler Routing Decision

Slack handlers that today spawn a Claude run for incoming triggers (`mention`, `dmActions`, `autoRespond`, `newQuery`, and the change-thread follow-up paths) SHALL consult the active-runs registry before constructing a new run.

#### Scenario: Existing run accepts the update

- **WHEN** a Slack handler is invoked for `(channelId, threadTs)` with text `T`
- **AND** the registry contains a `ClaudeRunHandle` for that key
- **THEN** the handler calls `handle.sendUpdate(T)`
- **AND** does NOT construct a new `ClaudeRunHandle`
- **AND** does NOT create a new streamer or perform fresh delivery setup

#### Scenario: Existing run rejects the update — fall through

- **WHEN** a Slack handler invokes `handle.sendUpdate(T)` and the call rejects
- **THEN** the handler proceeds with its normal path: spawn a fresh `ClaudeRunHandle` (which will resume from the persisted `sdkSessionId`)

#### Scenario: No existing run — spawn fresh

- **WHEN** a Slack handler is invoked and the registry has no entry for `(channelId, threadTs)`
- **THEN** the handler constructs a fresh `ClaudeRunHandle` using the existing path

### Requirement: Registry Replaces Prior Tracking Mechanisms

The active-runs registry SHALL be the only place that tracks which Claude runs are currently in flight per thread. The prior `inFlightRequests` registry, `withInFlightTracking` wrapper, `processingThreads` Set in `autoRespond`, and `activeChange.abortController` field SHALL no longer be used for cancellation lookups.

#### Scenario: Stop pipeline uses the registry

- **WHEN** the stop pipeline is invoked for `(channelId, threadTs)`
- **THEN** it looks up the active-runs registry for that key
- **AND** if a handle is registered, calls `handle.stop("user requested")`
- **AND** does NOT iterate any other in-flight registry

#### Scenario: messageChanged uses the registry

- **WHEN** a `message_changed` event arrives for a message that is the trigger of an active run
- **THEN** the handler resolves `threadTs` from the message
- **AND** calls `handle.stop()` on the registered handle (if any)
- **AND** then proceeds with the existing restart-with-edited-text logic

#### Scenario: autoRespond uses the registry

- **WHEN** an auto-respond rule matches a thread reply
- **AND** the registry contains a handle for that thread
- **THEN** the rule calls `handle.sendUpdate(text)` instead of dropping the message
- **AND** does NOT consult any prior `processingThreads` Set

#### Scenario: Worker cancellation uses the registry

- **WHEN** a worker run is cancelled (via `cancel_worker_run`, stop reaction, or inline stop emoji)
- **THEN** the cancellation calls `handle.stop(reason)` on the worker's `ClaudeRunHandle`
- **AND** does NOT consult `activeChange.abortController` (which no longer exists as a separate field)

### Requirement: Registry Entry Start Time and Snapshot

Each active-runs registry entry SHALL record the time at which the run was registered. The registry SHALL expose a `snapshot()` accessor that returns the current set of active runs without mutating state, for consumption by the runtime status endpoint. The snapshot SHALL report, per run, the lookup identity (`channel`, `thread`), the handle's lifecycle `status`, and the elapsed age in milliseconds since registration (`ageMs`). The existing `size()` accessor and all routing behavior SHALL be unchanged. No entry SHALL be evicted on the basis of age — the snapshot only observes; it does not reap.

#### Scenario: Entry records its start time

- **WHEN** a `ClaudeRunHandle` is registered for a `(channelId, threadTs)` slot
- **THEN** the entry records the registration timestamp

#### Scenario: Snapshot reports per-run age and identity

- **WHEN** `snapshot()` is called while one or more runs are registered
- **THEN** it returns one entry per active run
- **AND** each entry includes `channel`, `thread`, the handle's `status`, and an `ageMs` derived from the recorded start time
- **AND** the registry contents are not modified by the call

#### Scenario: Snapshot of an empty registry

- **WHEN** `snapshot()` is called and no runs are registered
- **THEN** it returns an empty set
- **AND** the reported active-run count is zero

#### Scenario: Snapshot does not evict stale entries

- **WHEN** a run has been registered for a long duration without settling
- **AND** `snapshot()` is called
- **THEN** the run is reported with a large `ageMs`
- **AND** the entry remains registered (the snapshot does not remove it)

