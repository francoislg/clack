## MODIFIED Requirements

### Requirement: In-Flight Request Registry

The system SHALL maintain an in-memory registry of currently executing Claude invocations, keyed by `channelId:messageTs` (the original triggering message).

#### Scenario: Request registered on invocation start

- **WHEN** `processMessage()` begins a Claude invocation
- **AND** the trigger type is `mentions`, `directMessages`, or `reactions`
- **THEN** the registry stores an entry with the `AbortController`, session ID, trigger type, and `threadTs`
- **AND** the entry does NOT include thinking state (streaming is managed by `processMessage`)
- **AND** the entry is keyed by `"{channelId}:{messageTs}"`

#### Scenario: Request deregistered on invocation completion

- **WHEN** a Claude invocation completes (success or error)
- **THEN** the registry entry for that invocation is removed
- **AND** this happens in a `finally` block to guarantee cleanup

#### Scenario: Request deregistered on abort

- **WHEN** a Claude invocation is aborted via the `AbortController`
- **THEN** the registry entry is removed before the abort signal is sent
- **AND** subsequent lookups for the same key return no match

#### Scenario: Reaction-triggered requests registered

- **WHEN** a request is triggered via reaction mode
- **THEN** an entry IS added to the in-flight registry with `triggerType: "reactions"`
- **AND** the entry includes the `threadTs` derived from the reacted message
- **AND** the entry can be aborted via the same mechanisms as mention/DM entries

## ADDED Requirements

### Requirement: Abort via Stop Reaction

The system SHALL support aborting any in-flight query-mode Claude invocation via the configured stop reaction (`config.reactions.stop`). Abort via stop reaction is thread-scoped and works regardless of which message in the thread the reaction is added to.

#### Scenario: Thread-scoped abort sweep

- **WHEN** a user adds the stop reaction to any message in a thread
- **THEN** the system resolves the `threadTs` of the reacted message
- **AND** iterates the in-flight registry to find every entry with matching `channelId` and `threadTs`
- **AND** aborts each matched `AbortController` and deregisters its entry

#### Scenario: Non-threaded message treated as thread root

- **WHEN** a user adds the stop reaction to a message that has no `thread_ts` (not a reply)
- **THEN** the system treats the message itself as the thread root (`threadTs = messageTs`)
- **AND** aborts any in-flight request keyed by `channelId:messageTs`

#### Scenario: Already-aborted entries skipped

- **WHEN** the thread-scoped sweep encounters an entry whose `AbortController.signal.aborted` is already `true`
- **THEN** the entry is skipped (no second abort) and deregistered if still present
- **AND** the sweep continues to other entries

#### Scenario: Stop reaction on thread with no in-flight entries

- **WHEN** a user adds the stop reaction to a thread with no matching registry entries
- **THEN** the abort sweep completes as a no-op
- **AND** disengagement (handled separately per auto-respond-tracking spec) still proceeds

#### Scenario: InFlightRequest carries threadTs

- **WHEN** an `InFlightRequest` is registered
- **THEN** it includes a `threadTs` field set to the thread the originating message belongs to
- **AND** for top-level (non-threaded) triggering messages, `threadTs` equals `messageTs`

### Requirement: Query-Mode Abort via Inline Stop Emoji

The system SHALL abort any in-flight query-mode Claude invocation for a thread when a message in that thread matches the inline stop-emoji detection rule (defined in `slack-message-trigger`), with the same thread-scoped semantics as abort via stop reaction.

#### Scenario: Inline stop emoji aborts in-flight query run

- **WHEN** a message matching the inline stop-emoji detection rule arrives in a thread
- **AND** a query-mode Claude invocation for that thread is currently in flight (registered in the in-flight request registry)
- **THEN** the system aborts the in-flight Claude invocation using the same thread-scoped sweep as the stop reaction
- **AND** suppresses any further streaming output for that request
- **AND** does NOT post a cancellation message (silent abort, symmetric with stop reaction)

#### Scenario: Inline stop emoji when no query-mode work is in flight

- **WHEN** a message matching the inline stop-emoji detection rule arrives in a thread
- **AND** no in-flight query-mode work exists for that thread
- **THEN** the system takes no cancellation action for query-mode
- **AND** still applies the disengagement effect (from `auto-respond-tracking`)

#### Scenario: Inline and reaction share the cancel-by-thread entry point

- **WHEN** either the stop reaction is added OR an inline-matching message arrives
- **THEN** both paths call the same internal cancel-by-thread function
- **AND** produce identical observable side effects (registry entries aborted, session disengaged, `cancelledBy` set on any active change)

## REMOVED Requirements

### Requirement: Reactions mode excluded

**Reason:** Reaction-triggered queries now need to be cancellable — specifically by the new stop reaction. Excluding them from the registry means the stop reaction cannot abort them. The original exclusion existed because no feature needed cancellation for reactions; that is no longer true.
**Migration:** None — registering reaction-triggered requests is a purely additive runtime behavior change. Existing edit-on-message flow (`Message Edit Detection` requirement) continues to work for mentions and DMs; applying it to reactions is benign.
