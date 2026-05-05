## MODIFIED Requirements

### Requirement: In-Flight Request Registry

The system SHALL maintain an in-memory registry of currently executing Claude invocations, keyed by `(channelId, threadTs)`. The registry stores `ClaudeRunHandle` references (per the `claude-run-handle` and `active-runs-registry` capabilities) and holds at most one entry per key. Per-message metadata (`triggerType`, `messageTs`, etc.) is NOT stored on the registry; it lives on the per-Slack-message delivery context that owns the streamer for that turn.

#### Scenario: Run registered on construction

- **WHEN** a `ClaudeRunHandle` is constructed for a run
- **THEN** the registry stores the handle keyed by `(channelId, threadTs)`
- **AND** the entry holds a reference to the handle (not a separate `AbortController`)

#### Scenario: Run deregistered on settle

- **WHEN** a `ClaudeRunHandle` settles (success or error)
- **THEN** the handle removes itself from the registry
- **AND** subsequent lookups for the same key return `undefined`

#### Scenario: Run deregistered on stop

- **WHEN** a `ClaudeRunHandle` is stopped via `handle.stop(...)`
- **THEN** the handle removes itself from the registry as part of the stop sequence
- **AND** the underlying `AbortController` is aborted exactly once

#### Scenario: Reaction-triggered runs registered

- **WHEN** a run is triggered via reaction mode
- **THEN** a handle IS registered with key `(channelId, threadTs)` derived from the reacted message
- **AND** the run can be stopped via the same `handle.stop()` mechanism as mention/DM runs

### Requirement: Message Edit Detection

The system SHALL listen for `message_changed` events and detect edits to messages that triggered an active run.

#### Scenario: Edit detected for active run

- **WHEN** a user edits a message that triggered an active run in a thread
- **AND** the active-runs registry contains a handle for `(channelId, threadTs)` derived from that message
- **THEN** the system retrieves the handle and proceeds with the abort+restart flow

#### Scenario: Edit ignored when no active run

- **WHEN** a user edits a message
- **AND** no active run exists for the corresponding `(channelId, threadTs)`
- **THEN** the system takes no action (the edit is ignored)

### Requirement: Abort and Restart on Edit

The system SHALL abort active runs via `handle.stop()` and optionally restart them with updated text when the triggering message is edited.

#### Scenario: Stream cleanup on stop

- **WHEN** a message edit calls `handle.stop()` on an active run
- **THEN** the message edit handler does NOT clean up streamer UI directly
- **AND** the consumer (`processMessage` / `executeAndDeliver`) detects the resulting `cancelled` state on the resolved `futureResponse` and calls `streamer.stop({ markdownText: "_Request cancelled._" })`

#### Scenario: Mention edit with bot mention retained

- **WHEN** a user edits a message that @mentioned the bot
- **AND** the edited text still contains the bot's `<@BOT_ID>` mention
- **THEN** the system calls `handle.stop()` on the active run
- **AND** restarts `processMessage()` with the new message text (bot mention stripped)

#### Scenario: Mention edit with bot mention removed

- **WHEN** a user edits a message that @mentioned the bot
- **AND** the edited text no longer contains `<@BOT_ID>`
- **THEN** the system calls `handle.stop()` on the active run
- **AND** does NOT restart processing

#### Scenario: DM edit restarts with new text

- **WHEN** a user edits a direct message that triggered an active run
- **AND** the edited text is not empty
- **THEN** the system calls `handle.stop()` on the active run
- **AND** restarts `processMessage()` with the new message text

#### Scenario: DM edit with empty text cancels only

- **WHEN** a user edits a direct message to empty text
- **THEN** the system calls `handle.stop()` on the active run
- **AND** does NOT restart processing

### Requirement: Query Mode Abort Support

The `askClaude()` function SHALL return a `ClaudeRunHandle` whose internal `AbortController` is forwarded to the SDK Query, supporting cancellation of in-flight queries.

#### Scenario: AbortController internal to handle

- **WHEN** `askClaude()` is called
- **THEN** the returned `ClaudeRunHandle` owns an `AbortController`
- **AND** the controller is forwarded to the Agent SDK's `query()` call
- **AND** callers do NOT pass an `AbortController` directly; they call `handle.stop()` instead

#### Scenario: Abort during query streaming

- **WHEN** the handle's `AbortController` is aborted (via `handle.stop()` or any other signal forwarded to it)
- **THEN** the `for await` loop throws an `AbortError`
- **AND** `askClaude()` resolves the handle's `futureResponse` with a `ClaudeResponse` indicating cancellation (not treated as an error to report)

### Requirement: Abort via Stop Reaction

The system SHALL support aborting any active query-mode run via the configured stop reaction (`config.reactions.stop`). Abort via stop reaction is thread-scoped and works regardless of which message in the thread the reaction is added to.

#### Scenario: Thread-scoped abort via handle

- **WHEN** a user adds the stop reaction to any message in a thread
- **THEN** the system resolves the `threadTs` of the reacted message
- **AND** looks up the active-runs registry for `(channelId, threadTs)`
- **AND** if a handle is found, calls `handle.stop("user requested via stop reaction")`
- **AND** does NOT iterate any other registry

#### Scenario: Non-threaded message treated as thread root

- **WHEN** a user adds the stop reaction to a message that has no `thread_ts` (not a reply)
- **THEN** the system treats the message itself as the thread root (`threadTs = messageTs`)
- **AND** looks up `(channelId, messageTs)` in the active-runs registry
- **AND** calls `handle.stop(...)` on the registered handle if any

#### Scenario: Already-stopped handle is idempotent

- **WHEN** the stop reaction is processed and the registered handle's `status` is already `"stopped"` or `"settled"`
- **THEN** the call to `handle.stop(...)` resolves without error and is a no-op
- **AND** the handle is already absent from the registry (it deregistered on settle/stop)

#### Scenario: Stop reaction on thread with no active run

- **WHEN** a user adds the stop reaction to a thread with no registered handle
- **THEN** the abort is a no-op
- **AND** disengagement (handled separately per auto-respond-tracking spec) still proceeds

### Requirement: Query-Mode Abort via Inline Stop Emoji

The system SHALL abort any active query-mode run for a thread when a message in that thread matches the inline stop-emoji detection rule (defined in `slack-message-trigger`), with the same thread-scoped semantics as abort via stop reaction.

#### Scenario: Inline stop emoji aborts active run

- **WHEN** a message matching the inline stop-emoji detection rule arrives in a thread
- **AND** an active query-mode run for that thread is registered in the active-runs registry
- **THEN** the system calls `handle.stop("stopped via inline emoji")` on the registered handle
- **AND** suppresses any further streaming output for that run
- **AND** does NOT post a cancellation message (silent abort, symmetric with stop reaction)

#### Scenario: Inline stop emoji when no query-mode work is in flight

- **WHEN** a message matching the inline stop-emoji detection rule arrives in a thread
- **AND** no active query-mode run exists for that thread
- **THEN** the system takes no cancellation action for query-mode
- **AND** still applies the disengagement effect (from `auto-respond-tracking`)

#### Scenario: Inline and reaction share the cancel-by-thread entry point

- **WHEN** either the stop reaction is added OR an inline-matching message arrives
- **THEN** both paths resolve `(channelId, threadTs)` and call `handle.stop(reason)` on the registered handle
- **AND** produce identical observable side effects (handle stopped, registry slot cleared, session disengaged, `cancelledBy` set on any active worker change)

## REMOVED Requirements

### Requirement: InFlightRequest carries threadTs scenario

**Reason:** The active-runs registry is now keyed directly by `(channelId, threadTs)`. There is no longer a separate `(channelId, messageTs)` entry that needs a sidecar `threadTs` field. The "top-level message uses messageTs as threadTs" rule is enforced at registration time (per `active-runs-registry` capability) rather than via a per-entry field.

**Migration:** Callers that previously read `inFlightRequest.threadTs` now use the registry key directly, or the `(channelId, threadTs)` derived from the originating message at the call site.
