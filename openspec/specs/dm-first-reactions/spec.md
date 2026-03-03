# dm-first-reactions Specification

## Purpose
Deliver reaction-triggered answers via direct message, supporting thread-based refinement, synthesis, and post-accept continuation.

## Requirements

### Requirement: DM Response Delivery
The system SHALL deliver reaction-triggered answers via direct message when the effective response type for the user is `"directMessage"`.

#### Scenario: Initial DM with investigation notice
- **WHEN** a user adds the trigger reaction and their effective response type is `"directMessage"`
- **THEN** the system opens a DM conversation with the user via `conversations.open`
- **AND** posts a message: "Looking into this message: <permalink>. I'll reply here when ready."
- **AND** does NOT add any thinking emoji to the original message
- **AND** does NOT post any ephemeral message in the channel

#### Scenario: Answer delivered in DM thread
- **WHEN** Claude Code generates the answer
- **THEN** the system posts the answer as a thread reply to the investigation notice DM
- **AND** renders Claude's actions as buttons (Claude is responsible for including `send_to_thread` and `reject` actions)
- **AND** the message mentions that the user can reply in the thread to refine, or click "Send to thread" to share

#### Scenario: Effective response type resolution
- **WHEN** determining the response type for a user
- **THEN** the system checks `reactions.responseType` config value
- **AND** if `"directMessage"`, checks user preferences for opt-out
- **AND** if user has opted out, falls back to `"ephemeral"`
- **AND** if config is `"ephemeral"`, always uses ephemeral regardless of user preferences

### Requirement: DM Thread Refinement
The system SHALL support natural thread-based refinement in DM threads linked to reaction-originated sessions.

#### Scenario: User replies in DM thread
- **WHEN** a user sends a message in a DM thread that is linked to a reaction-originated session
- **THEN** the system treats the reply as a refinement instruction
- **AND** regenerates the answer incorporating the new instructions and full conversation history
- **AND** posts the updated answer as a new thread reply with action buttons derived from Claude's response

#### Scenario: Multiple refinement rounds
- **WHEN** a user sends multiple replies in the DM thread
- **THEN** each reply triggers a new refinement pass
- **AND** all prior conversation history is included in subsequent Claude queries
- **AND** Claude receives correct delivery context (derived from session state) on every refinement call
- **AND** the latest response includes action buttons appropriate to Claude's response

#### Scenario: Refinement requests a code change
- **WHEN** a user replies in the DM thread requesting a code change (e.g., "make that change")
- **THEN** Claude receives full delivery context and changes workflow capability
- **AND** Claude can include `propose_change` or other action tools as appropriate
- **AND** the response is not limited to only `send_to_thread` and `reject` actions

#### Scenario: Auto send to thread on explicit request
- **WHEN** a user replies in the DM thread asking to send/share the answer (e.g., "send this to the thread", "share it")
- **AND** Claude includes a `send_to_thread` action with `auto: true` in its response
- **THEN** the system posts the answer directly to the original channel thread (skipping synthesis)
- **AND** stores the `channelPostTs` for future updates
- **AND** confirms in the DM thread: "Answer posted to the original thread."

### Requirement: Synthesis and Send to Thread
The system SHALL synthesize the full DM conversation into a clean answer when the user requests to send to the original thread.

#### Scenario: Send to thread triggers synthesis
- **WHEN** the user clicks "Send to thread" on any DM response
- **THEN** the system makes an additional Claude call to synthesize the full DM conversation
- **AND** the synthesis prompt instructs Claude to produce a unified, polished answer as if responding directly to the original question
- **AND** the synthesis is posted in the DM thread with "Accept", "Edit", and "Reject" buttons

#### Scenario: Accept synthesis posts to channel
- **WHEN** the user clicks "Accept" on the synthesis message
- **THEN** the system posts the synthesized answer as a visible thread reply in the original channel thread
- **AND** stores the channel message timestamp for potential future updates

#### Scenario: Edit synthesis before accepting
- **WHEN** the user clicks "Edit" on the synthesis message
- **THEN** the system opens a modal allowing the user to edit the synthesis text
- **AND** on submission, posts the edited version to the original channel thread

#### Scenario: Reject synthesis
- **WHEN** the user clicks "Reject" on the synthesis message
- **THEN** the system acknowledges with "Got it, discarded." in the DM thread
- **AND** the user can continue refining or send again later

### Requirement: Post-Accept Continuation
The system SHALL allow users to return to a DM thread after an answer has been posted to the channel.

#### Scenario: User continues after accept
- **WHEN** a user sends a new message in a DM thread where an answer was previously accepted
- **THEN** the system treats it as a new refinement round
- **AND** regenerates incorporating the new instructions
- **AND** triggers a new synthesis when "Send to thread" is clicked

#### Scenario: Update existing channel post
- **WHEN** the user clicks "Update original post" after a post-accept synthesis
- **THEN** the system edits the previously posted channel message via `chat.update`
- **AND** replaces the content with the new synthesis

#### Scenario: Post new reply in channel
- **WHEN** the user clicks "Post new reply" after a post-accept synthesis
- **THEN** the system posts a new visible thread reply in the original channel thread
- **AND** updates the stored channel message timestamp to this new message

### Requirement: DM Reject Action
The system SHALL acknowledge rejection in DM mode.

#### Scenario: Reject in DM thread
- **WHEN** the user clicks "Reject" on a DM response (non-synthesis)
- **THEN** the system posts "Got it, discarded." in the DM thread
- **AND** the session remains available for potential re-trigger

### Requirement: NotifyHiddenThread Suppression
The system SHALL skip hidden thread DM notifications for users in DM mode.

#### Scenario: Suppress duplicate DM notification
- **WHEN** a reaction triggers an investigation for a user whose effective response type is `"directMessage"`
- **AND** `slack.notifyHiddenThread` is enabled
- **THEN** the system does NOT send the hidden thread notification DM
- **AND** the user only receives the DM-first investigation thread
