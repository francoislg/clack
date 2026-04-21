## ADDED Requirements

### Requirement: Disengagement via Stop Reaction

The system SHALL support disengagement from a thread when a user adds the configured stop reaction (`config.reactions.stop`) to any message in the thread.

#### Scenario: Stop reaction sets autoResponseActive false

- **WHEN** a user adds the configured stop reaction to any message in a thread
- **AND** a session exists for the thread
- **THEN** the system sets `autoResponseActive = false` on that session
- **AND** persists the updated session to disk
- **AND** the thread stops being auto-responded to on subsequent replies

#### Scenario: Stop reaction with no session

- **WHEN** a user adds the configured stop reaction to a message in a thread with no existing session
- **THEN** the disengagement step is a no-op (nothing to update)
- **AND** the handler does not create a session purely to mark it disengaged
- **AND** no error is raised

#### Scenario: Stop reaction is idempotent on disengagement

- **WHEN** a user adds the stop reaction to a thread whose session already has `autoResponseActive === false`
- **THEN** the disengagement step is a no-op
- **AND** no persistence write occurs (optional optimization) OR a redundant persistence is performed without error
- **AND** the thread remains disengaged

#### Scenario: Stop reaction logs disengagement

- **WHEN** a stop reaction sets `autoResponseActive = false` on a session that was previously active
- **THEN** the system logs the disengagement at info level, including the session ID and reactor's user label

### Requirement: Disengagement via Inline Stop Emoji

The system SHALL disengage a thread from auto-respond tracking when a message in the thread matches the inline stop-emoji detection rule (defined in `slack-message-trigger`), with the same effect as the stop reaction.

#### Scenario: Inline stop emoji in thread reply disengages the session

- **WHEN** a non-bot thread reply arrives in a thread with an existing Clack session
- **AND** the reply matches the inline stop-emoji detection rule (trimmed text ≤60 chars and contains the configured stop emoji)
- **THEN** the system sets `autoResponseActive = false` on the session
- **AND** persists the session to disk
- **AND** does NOT run pre-analysis
- **AND** does NOT call `processMessage`

#### Scenario: Inline stop emoji in a thread without an active session

- **WHEN** a message matching the inline stop-emoji detection rule arrives in a thread that has no Clack session
- **THEN** the system takes no session-level action (nothing to disengage)
- **AND** the cancel-by-thread pipeline still runs to abort any in-flight work that may exist outside session tracking
- **AND** no error is raised

#### Scenario: Inline stop emoji on already-disengaged session is idempotent

- **WHEN** a message matching the inline stop-emoji detection rule arrives in a thread whose session already has `autoResponseActive === false`
- **THEN** the disengagement step is a no-op
- **AND** the thread remains disengaged
- **AND** no error is raised

#### Scenario: Inline stop emoji and stop reaction produce identical disengagement

- **WHEN** either surface (reaction or inline match) fires for the same thread
- **THEN** `autoResponseActive` is set to `false` via the same internal call path
- **AND** both paths log at info level with the sender/reactor's user label and thread link

### Requirement: Re-Activation via Change-Thread Button Click

The system SHALL re-activate auto-respond tracking when a user clicks any change-thread action button (Merge, Review, Close, Accept, Edit, or other follow-up buttons) on a session with `autoResponseActive === false`. This re-activation is symmetric with the existing `@mention` re-activation.

#### Scenario: Button click in disengaged thread re-activates tracking

- **WHEN** a user clicks a change-thread action button
- **AND** a session exists for the thread with `autoResponseActive === false`
- **THEN** the handler sets `autoResponseActive = true` on the session
- **AND** persists the updated session to disk
- **AND** proceeds with normal button-action processing

#### Scenario: Button click in active thread unchanged

- **WHEN** a user clicks a change-thread action button
- **AND** the session has `autoResponseActive === true`
- **THEN** the handler proceeds normally (no re-activation step, no extra persistence)

#### Scenario: Button click applies to any change-thread action

- **WHEN** the re-activation check runs
- **THEN** it applies uniformly to Merge, Review, Close, Accept, Edit, and any other change-thread follow-up buttons
- **AND** it does NOT matter which specific action the button represents
