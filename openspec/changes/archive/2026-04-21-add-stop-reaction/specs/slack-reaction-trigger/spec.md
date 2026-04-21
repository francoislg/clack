## ADDED Requirements

### Requirement: Stop Reaction Trigger

The system SHALL support a configurable "stop" reaction emoji (`config.reactions.stop`) that, when added to any message in a thread, cancels any in-flight Claude work for that thread and disengages the thread from auto-respond. When `config.reactions.stop` is unset, `null`, or empty, the feature is disabled.

#### Scenario: Stop reaction added to triggering message

- **WHEN** a user adds the configured stop emoji to a message that triggered a Claude query or worker run
- **THEN** the system resolves the thread the message belongs to
- **AND** aborts the in-flight request for that thread (see request-cancellation and worker-cancellation specs)
- **AND** sets the thread's session `autoResponseActive` to `false` (see auto-respond-tracking spec)
- **AND** takes no destructive action on git, the worktree, or any PR

#### Scenario: Stop reaction added to bot's streamed response

- **WHEN** a user adds the configured stop emoji to a message posted by the bot in a thread
- **THEN** the system resolves the thread
- **AND** aborts any in-flight request associated with that thread
- **AND** sets the thread's session `autoResponseActive` to `false`

#### Scenario: Stop reaction added to thread parent

- **WHEN** a user adds the configured stop emoji to the parent message of a thread Clack is active in
- **THEN** the system resolves the thread (using the message as the thread parent)
- **AND** aborts any in-flight request associated with that thread
- **AND** sets the thread's session `autoResponseActive` to `false`

#### Scenario: Stop reaction added to another user's thread reply

- **WHEN** a user adds the configured stop emoji to any other message in the thread (e.g., a teammate's reply)
- **THEN** the system resolves the thread from that message's `thread_ts`
- **AND** aborts any in-flight request associated with that thread
- **AND** sets the thread's session `autoResponseActive` to `false`

#### Scenario: Stop reaction on message with no in-flight work

- **WHEN** a user adds the stop emoji to a thread with no in-flight Claude work
- **THEN** the system still disengages the thread (sets `autoResponseActive = false`)
- **AND** returns without error (no-op on the abort side)

#### Scenario: Stop reaction on already-stopped thread

- **WHEN** a user adds the stop emoji to a thread whose session already has `autoResponseActive === false` and no in-flight work
- **THEN** the handler is idempotent (no error, no status change, no double-abort)

#### Scenario: Stop reaction when feature is disabled

- **WHEN** `config.reactions.stop` is unset, `null`, or an empty string
- **AND** a user adds any emoji to any message
- **THEN** the stop-reaction handler takes no action
- **AND** the system behaves as if the stop feature did not exist

#### Scenario: Stop emoji matches exactly

- **WHEN** a user adds an emoji whose name does not exactly match `config.reactions.stop`
- **THEN** the stop-reaction handler takes no action
- **AND** the event continues through other reaction handlers normally

#### Scenario: Stop reaction on message in channel the bot cannot read

- **WHEN** a user adds the stop emoji to a message and the bot lacks access to the channel
- **THEN** the system silently takes no action (matches existing reaction-handler behavior)

#### Scenario: Stop reaction applies regardless of reactor identity

- **WHEN** any user who can see the thread adds the stop emoji
- **THEN** the stop action applies (no role or session-ownership check)

### Requirement: Stop Reaction Configuration

The system SHALL accept an optional `reactions.stop` field in `config.json` specifying the emoji name (without colons) to treat as the stop trigger. The field SHALL default to `"octagonal_sign"` on new installs and SHALL be added to existing installs via a boot migration.

#### Scenario: Default value on new install

- **WHEN** a fresh Clack install is initialized
- **THEN** `config.reactions.stop` is set to `"octagonal_sign"` by default

#### Scenario: Custom stop emoji

- **WHEN** an admin sets `config.reactions.stop` to a custom emoji name (e.g., `"clack-stop"`)
- **THEN** the stop-reaction handler listens for that emoji name
- **AND** the default `octagonal_sign` no longer triggers stop behavior

#### Scenario: Explicit disable

- **WHEN** `config.reactions.stop` is set to `null` or an empty string
- **THEN** the stop-reaction feature is disabled

#### Scenario: Config validation

- **WHEN** `config.reactions.stop` is present and not null/empty
- **THEN** it MUST be a string containing an emoji name without surrounding colons
- **AND** validation rejects values that include `:` or whitespace

#### Scenario: Migration adds default to existing config

- **WHEN** a boot migration runs against a config that does not have `reactions.stop` defined
- **THEN** the migration adds `reactions.stop: "octagonal_sign"`
- **AND** persists the updated config

#### Scenario: Migration is idempotent

- **WHEN** the migration runs against a config that already has `reactions.stop` defined (including `null`)
- **THEN** the migration leaves the field unchanged
