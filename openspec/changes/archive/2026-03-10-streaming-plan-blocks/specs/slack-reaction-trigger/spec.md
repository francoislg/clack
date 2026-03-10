## REMOVED Requirements

### Requirement: Ephemeral Response Delivery
**Reason**: Ephemeral responses are removed entirely. Reactions now post visible messages either in the channel thread or via DM, based on user preference.
**Migration**: Users who received ephemeral responses will now receive DM responses (default) or visible thread responses. Configure preference via Home Tab settings.

### Requirement: Accept Action
**Reason**: Accept only existed to publish ephemeral responses to the thread. With visible responses, this action is unnecessary.
**Migration**: No action needed. Thread-mode responses are already visible. DM-mode responses use `send_to_thread`.

### Requirement: Reject Action
**Reason**: Reject only existed to dismiss ephemeral responses. With visible responses, there is no dismissal mechanism needed.
**Migration**: No action needed. Users can ignore responses or use the delete icon button in feedback controls.

### Requirement: Refine Action
**Reason**: Refine only existed for ephemeral responses (to regenerate in-place). For DM mode, thread-based refinement replaces this. For thread mode, users reply in the thread.
**Migration**: Reply in the thread to refine answers.

### Requirement: Response Type Configuration
**Reason**: The `reactions.responseType` config field (`"ephemeral"` | `"directMessage"`) is removed. Delivery mode is now always determined by user preference (`"dm"` | `"thread"`).
**Migration**: Remove `reactions.responseType` from config. Boot migration handles this automatically.

## MODIFIED Requirements

### Requirement: Reaction Detection
Listen for configurable emoji reactions and initiate answer generation. When a matching reaction is detected, the system SHALL start a streaming response in the target determined by user preference (DM channel or channel thread).

#### Scenario: Trigger reaction added
- **WHEN** a user adds the configured trigger emoji to a message
- **THEN** the system starts a streaming response targeted at the user's preferred delivery mode (DM or thread)

#### Scenario: Work-mode reaction added
- **WHEN** a user with dev+ role adds the configured work-mode emoji to a message
- **THEN** the system starts a streaming response with `workMode: true` in the user's preferred delivery mode

#### Scenario: Non-trigger reaction ignored
- **WHEN** a user adds an emoji that does not match any configured trigger
- **THEN** no processing occurs

#### Scenario: Bot not in channel
- **WHEN** the bot lacks access to the channel where the reaction was added
- **THEN** the system silently ignores the reaction (no error posted)
