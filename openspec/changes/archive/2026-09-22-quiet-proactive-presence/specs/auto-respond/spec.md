## MODIFIED Requirements

### Requirement: Auto-Respond Trigger Type

The system SHALL support `"autoRespond"` as a trigger type throughout the processing pipeline, with early-exit handling in functions that index into trigger-specific config.

#### Scenario: TriggerType union includes autoRespond
- **WHEN** the system defines the `TriggerType` type
- **THEN** it includes `"autoRespond"` as a valid value

#### Scenario: Changes Workflow disabled for autoRespond
- **WHEN** the trigger type is `"autoRespond"`
- **THEN** the Changes Workflow is NOT available for the session
- **AND** Claude does NOT receive change proposal tools
- **AND** `isChangesEnabledForTrigger()` SHALL return `false` before attempting to access `config[triggerType]` (since `"autoRespond"` is not a key of the Config object)

#### Scenario: Response posted as thread reply
- **WHEN** the trigger type is `"autoRespond"`
- **AND** Claude calls `submit_response`
- **THEN** the response is posted as a thread reply on the triggering message

#### Scenario: Delivery context for auto-respond
- **WHEN** the system builds the delivery context prompt for a session with triggerType `"autoRespond"` or `"threadReply"`
- **THEN** the prompt SHALL indicate this is an automated response to a channel message
- **AND** the prompt SHALL NOT include `accept`, `reject`, or `send_to_thread` action guidance
- **AND** the prompt SHALL include guidance that Claude can use `skip_response` when the conversation doesn't need a Clack response (e.g., users talking to each other, question already answered)

#### Scenario: Extra context injected into response
- **WHEN** a matched rule has an `extraContext` field
- **THEN** the extra context is prepended to the message text sent to `processMessage()`

#### Scenario: Auto-respond runs are cancelled only through the thread's stop signals
- **WHEN** an auto-respond run is in progress
- **THEN** it is registered in the active-runs registry like every other run, so a stop reaction or inline stop emoji on the thread cancels it
- **AND** editing or deleting the triggering message does NOT cancel it

#### Scenario: Skipped auto-respond leaves no trace
- **WHEN** Claude skips a response in an auto-respond session
- **THEN** if the turn's deferred progress surface never committed, no Slack message was created and no Slack call is made for it
- **AND** if the surface committed and opened a card, the streamer message is deleted from the channel thread
- **AND** no session is persisted
- **AND** from the user's perspective, Clack never responded

## ADDED Requirements

### Requirement: Auto-Respond Rule UI — Attention Level

The Home Tab "Add Rule" and "Edit Rule" modals SHALL include an optional attention-level select, and the Home Tab rule summary SHALL surface a rule's configured level. A rule created or edited from the Home Tab SHALL be able to set, change, and clear `attentionLevel`.

The select SHALL offer the four settable rungs (`always | high | medium | low`) plus a default choice that clears the field, and SHALL NOT offer `"off"` — a rule may never seed a disengaged session. Option text SHALL describe thread follow-up behaviour (see the `attention-level` capability).

#### Scenario: Attention level field displayed

- **WHEN** an admin opens the Add Rule or Edit Rule modal
- **THEN** the modal displays an attention-level select
- **AND** the field is optional (not required)
- **AND** the options are the four settable rungs plus a default choice, with `"off"` absent

#### Scenario: Attention level pre-populated on edit

- **WHEN** an admin opens the Edit Rule modal for a rule that has `attentionLevel` set
- **THEN** the select is pre-populated with the existing value

#### Scenario: Attention level defaults on edit when unset

- **WHEN** an admin opens the Edit Rule modal for a rule with no `attentionLevel`
- **THEN** the select shows the default choice

#### Scenario: Attention level saved on add

- **WHEN** an admin submits the Add Rule modal with an attention level selected
- **THEN** the created rule is persisted with that `attentionLevel`

#### Scenario: Attention level saved on edit

- **WHEN** an admin submits the Edit Rule modal with an attention level selected
- **THEN** the value is saved to the rule's `attentionLevel` field

#### Scenario: Attention level cleared on submission

- **WHEN** an admin submits either modal with the default choice selected
- **THEN** the `attentionLevel` field is removed from the rule
- **AND** sessions the rule creates fall back to `"medium"`

#### Scenario: Attention level displayed in rule summary

- **WHEN** the Home Tab renders a rule that has `attentionLevel` set
- **THEN** the rule summary shows the configured level using its localized short label
- **AND** a rule with no `attentionLevel` set shows no level marker

#### Scenario: Followed conversations use the same level labels

- **WHEN** the Home Tab renders a followed channel conversation's attention level in the Auto-Respond section
- **THEN** it uses the same localized short label as the rule summary for that level, not the raw enum value

#### Scenario: Existing rules keep their level through an unrelated edit

- **GIVEN** a rule with `attentionLevel: "always"` configured outside the Home Tab
- **WHEN** an admin edits only its channels from the Edit Rule modal and submits
- **THEN** the rule's `attentionLevel` is still `"always"`
