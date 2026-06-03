## MODIFIED Requirements

### Requirement: Auto-Respond Tracking State

The system SHALL represent thread auto-respond engagement through the per-session `attentionLevel` dial (see the `attention-level` capability), NOT through a separate `autoResponseActive` boolean. A thread is engaged when `attentionLevel !== "off"` and disengaged when `attentionLevel === "off"`.

#### Scenario: Default to engaged on session creation

- **WHEN** a new session is created (any trigger type)
- **THEN** its initial `attentionLevel` is resolved per the `attention-level` capability (default `"medium"`, never `"off"`)
- **AND** the field is persisted in `context.json`

#### Scenario: Existing sessions without field default to engaged

- **WHEN** a session is loaded from disk and does not have an `attentionLevel` field
- **THEN** the system applies the read-time migration (`autoResponseActive === false → "off"`, otherwise `→ "medium"`)
- **AND** no boot migration is required

#### Scenario: Thread auto-respond skips disengaged sessions

- **WHEN** a thread reply arrives
- **AND** a session exists for the thread with `attentionLevel === "off"`
- **THEN** the system does NOT run pre-analysis
- **AND** does NOT invoke Claude
- **AND** returns immediately (no cost incurred)

#### Scenario: Tracking state persisted across restarts

- **WHEN** `attentionLevel` is set to `"off"`
- **AND** the application restarts
- **THEN** the session loaded from disk retains `attentionLevel: "off"`
- **AND** the thread remains disengaged

#### Scenario: Top-level auto-respond messages unaffected

- **WHEN** a top-level message matches an auto-respond rule
- **THEN** the `attentionLevel` on any existing session is NOT consulted
- **AND** a new session is created with its initial level resolved from the rule (default `"medium"`)

### Requirement: Disengagement via Pre-Analysis

The system SHALL support disengagement from a thread when the pre-analysis classifier determines the conversation has moved on, but ONLY when the session's level is `"low"` (see the `attention-level` capability's low-rung auto-disengage rule).

#### Scenario: Pre-analysis returns "stop" on a low thread

- **WHEN** pre-analysis evaluates a thread message on a `"low"` session and returns `"stop"`
- **THEN** the system sets `attentionLevel = "off"` on the session
- **AND** persists the updated session to disk
- **AND** does NOT invoke Claude for this message
- **AND** logs the disengagement at info level

#### Scenario: Higher-rung threads are not disengaged by the classifier

- **WHEN** a thread reply is evaluated on a `"medium"` or `"high"` session
- **THEN** the classifier cannot return a disengaging verdict
- **AND** `attentionLevel` is not changed to `"off"` by pre-analysis

### Requirement: Disengagement via stop_tracking Tool

The system SHALL provide a `stop_tracking` query tool for cross-thread disengagement, which sets the target session's `attentionLevel` to `"off"`.

#### Scenario: Stop tracking by Slack URL

- **WHEN** Claude calls `stop_tracking` with a valid Slack message URL
- **THEN** the tool parses the URL to extract channel ID and message timestamp
- **AND** looks up the session via `findSessionByThread(channelId, threadTs)`
- **AND** sets `attentionLevel = "off"` on the found session
- **AND** persists the updated session to disk
- **AND** returns confirmation with the thread details

#### Scenario: No session found for URL

- **WHEN** Claude calls `stop_tracking` with a URL that has no associated session
- **THEN** the tool returns an error indicating no tracked session was found for that thread

#### Scenario: Permission check on stop_tracking

- **WHEN** a non-admin user calls `stop_tracking`
- **AND** the target session's `userId` does not match the requesting user
- **THEN** the tool returns an error indicating insufficient permissions

#### Scenario: Admin can stop any thread

- **WHEN** an admin or owner calls `stop_tracking`
- **THEN** the tool disengages the thread (sets `attentionLevel = "off"`) regardless of who created the session

#### Scenario: Tool registered when Slack client available

- **WHEN** the tool server is built in query mode
- **AND** a Slack client is available in the context
- **THEN** the `stop_tracking` tool is registered for all roles (runtime permission checks apply per scenarios below)

### Requirement: Re-Activation via @Mention

The system SHALL re-activate auto-respond tracking when Clack is explicitly @mentioned in a disengaged thread, setting `attentionLevel = "medium"`.

#### Scenario: Mention in disengaged thread re-activates tracking

- **WHEN** a user @mentions Clack in a thread
- **AND** a session exists for the thread with `attentionLevel === "off"`
- **THEN** the mention handler sets `attentionLevel = "medium"` on the session
- **AND** persists the updated session to disk
- **AND** proceeds with normal mention processing

#### Scenario: Mention in thread with no session

- **WHEN** a user @mentions Clack in a thread with no existing session
- **THEN** normal mention processing creates a new session
- **AND** `attentionLevel` defaults to `"medium"` (standard creation behavior)

#### Scenario: Mention in already-engaged thread

- **WHEN** a user @mentions Clack in a thread with `attentionLevel !== "off"`
- **THEN** the mention handler proceeds normally
- **AND** the existing `attentionLevel` is preserved (no reset)

### Requirement: Prompt Guidance for Disengagement

The system SHALL include prompt guidance and tool-schema guidance telling Claude when to set `attention_level: "off"` to disengage, including explicit dismissal phrases.

#### Scenario: submit_response schema description names dismissal triggers

- **WHEN** the `submit_response` tool schema is constructed for a session that supports tracking
- **THEN** the `attention_level` parameter's description names explicit user dismissals ("thanks Clack", "you're done", "that's all") as canonical triggers for `"off"`
- **AND** states that `attention_level: "off"` may be combined with a normal response (reply and disengage in the same turn)
- **AND** states that `attention_level: "off"` may also be combined with `skip_response: true` (decline to answer and disengage)

#### Scenario: Delivery-context prompt includes attention-level guidance

- **WHEN** the delivery context prompt is built for a session that supports tracking
- **THEN** the prompt includes guidance that Claude can lower the level (or set `"off"`) as a thread winds down, and raise it when the user is actively engaged
- **AND** the prompt distinguishes `skip_response` alone (temporary silence, stay engaged) from `attention_level: "off"` (permanent disengage)

## REMOVED Requirements

### Requirement: Disengagement via submit_response

**Reason**: The standalone `disengage` boolean on `submit_response` is replaced by `attention_level: "off"` on the unified attention dial. Disengagement is no longer a separate flag — it is the floor value of the same parameter Claude uses to raise or lower a thread's attention.

**Migration**: Replace any `submit_response` call carrying `disengage: true` with `attention_level: "off"`. The combination semantics are preserved: `attention_level: "off"` may accompany a normal response (reply then disengage) or `skip_response: true` (decline then disengage). The persistence, idempotency, and failed-delivery behaviors are now specified by the `attention-level` capability's "submit_response Attention Level Control" requirement and continue to set the session to `"off"` only on successful delivery.

## MODIFIED Requirements

### Requirement: Disengagement via Stop Reaction

The system SHALL support disengagement from a thread when a user adds the configured stop reaction (`config.reactions.stop`) to any message in the thread, by setting `attentionLevel = "off"`.

#### Scenario: Stop reaction sets attentionLevel off

- **WHEN** a user adds the configured stop reaction to any message in a thread
- **AND** a session exists for the thread
- **THEN** the system sets `attentionLevel = "off"` on that session
- **AND** persists the updated session to disk
- **AND** the thread stops being auto-responded to on subsequent replies

#### Scenario: Stop reaction with no session

- **WHEN** a user adds the configured stop reaction to a message in a thread with no existing session
- **THEN** the disengagement step is a no-op (nothing to update)
- **AND** the handler does not create a session purely to mark it disengaged
- **AND** no error is raised

#### Scenario: Stop reaction is idempotent on disengagement

- **WHEN** a user adds the stop reaction to a thread whose session already has `attentionLevel === "off"`
- **THEN** the disengagement step is a no-op
- **AND** the thread remains disengaged

#### Scenario: Stop reaction logs disengagement

- **WHEN** a stop reaction sets `attentionLevel = "off"` on a session that was previously engaged
- **THEN** the system logs the disengagement at info level, including the session ID and reactor's user label

### Requirement: Disengagement via Inline Stop Emoji

The system SHALL disengage a thread from auto-respond tracking when a message in the thread matches the inline stop-emoji detection rule (defined in `slack-message-trigger`), with the same effect as the stop reaction (sets `attentionLevel = "off"`).

#### Scenario: Inline stop emoji in thread reply disengages the session

- **WHEN** a non-bot thread reply arrives in a thread with an existing Clack session
- **AND** the reply matches the inline stop-emoji detection rule (trimmed text ≤60 chars and contains the configured stop emoji)
- **THEN** the system sets `attentionLevel = "off"` on the session
- **AND** persists the session to disk
- **AND** does NOT run pre-analysis
- **AND** does NOT call `processMessage`

#### Scenario: Inline stop emoji in a thread without an active session

- **WHEN** a message matching the inline stop-emoji detection rule arrives in a thread that has no Clack session
- **THEN** the system takes no session-level action (nothing to disengage)
- **AND** the cancel-by-thread pipeline still runs to abort any in-flight work that may exist outside session tracking
- **AND** no error is raised

#### Scenario: Inline stop emoji on already-disengaged session is idempotent

- **WHEN** a message matching the inline stop-emoji detection rule arrives in a thread whose session already has `attentionLevel === "off"`
- **THEN** the disengagement step is a no-op
- **AND** the thread remains disengaged
- **AND** no error is raised

#### Scenario: Inline stop emoji and stop reaction produce identical disengagement

- **WHEN** either surface (reaction or inline match) fires for the same thread
- **THEN** `attentionLevel` is set to `"off"` via the same internal call path
- **AND** both paths log at info level with the sender/reactor's user label and thread link

### Requirement: Re-Activation via Change-Thread Button Click

The system SHALL re-activate auto-respond tracking when a user clicks any change-thread action button (Merge, Review, Close, Accept, Edit, or other follow-up buttons) on a disengaged session (`attentionLevel === "off"`), setting `attentionLevel = "medium"`. This re-activation is symmetric with the existing `@mention` re-activation.

#### Scenario: Button click in disengaged thread re-activates tracking

- **WHEN** a user clicks a change-thread action button
- **AND** a session exists for the thread with `attentionLevel === "off"`
- **THEN** the handler sets `attentionLevel = "medium"` on the session
- **AND** persists the updated session to disk
- **AND** proceeds with normal button-action processing

#### Scenario: Button click in engaged thread unchanged

- **WHEN** a user clicks a change-thread action button
- **AND** the session has `attentionLevel !== "off"`
- **THEN** the handler proceeds normally (no re-activation step, no extra persistence)

#### Scenario: Button click applies to any change-thread action

- **WHEN** the re-activation check runs
- **THEN** it applies uniformly to Merge, Review, Close, Accept, Edit, and any other change-thread follow-up buttons
- **AND** it does NOT matter which specific action the button represents
