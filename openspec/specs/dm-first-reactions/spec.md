# dm-first-reactions Specification

## Purpose
Deliver reaction-triggered answers via direct message, supporting thread-based refinement, synthesis, and post-accept continuation.

## Requirements

### Requirement: DM Response Delivery
The system SHALL deliver reaction-triggered answers via DM when user preference is `"dm"`. The DM flow uses streaming with plan blocks instead of posting separate investigation notice and answer messages.

#### Scenario: Stream started in DM
- **WHEN** a user with `reactionDelivery: "dm"` preference reacts with the trigger emoji
- **THEN** the system opens a DM conversation and starts a chat stream in a new DM thread

#### Scenario: Answer streamed in DM thread
- **WHEN** Claude completes processing
- **THEN** the answer is delivered via the stream in the DM thread, with task cards showing progress and the final answer streamed as markdown

#### Scenario: Default delivery is DM
- **WHEN** a user has no explicit `reactionDelivery` preference set
- **THEN** the system defaults to DM delivery

### Requirement: DM Thread Refinement
The system SHALL support natural thread-based refinement in DM threads. Users reply in the DM thread to ask follow-up questions or refine the answer.

#### Scenario: User replies in DM thread
- **WHEN** a user sends a message in a DM thread that belongs to a reaction session
- **THEN** the system starts a new streaming response in the same DM thread with the refinement context

#### Scenario: Multiple refinement rounds
- **WHEN** a user sends additional replies in the DM thread
- **THEN** each reply triggers a new streaming response with cumulative context

#### Scenario: Refinement requests a code change
- **WHEN** a refinement message in the DM thread implies a code change and the user has dev+ permissions
- **THEN** Claude MAY propose a change via `propose_change` or `request_update` actions

#### Scenario: Auto send to thread on explicit request
- **WHEN** a DM thread refinement explicitly asks to share the answer
- **THEN** Claude includes `send_to_thread` with `auto: true` in the response actions

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
The system SHALL allow users to return to DM thread after answer posted to channel.

#### Scenario: User continues after accept
- **WHEN** a user sends a message in the DM thread after an answer was already posted to the channel
- **THEN** the system processes it as a new refinement with streaming

#### Scenario: Update existing channel post
- **WHEN** refinement after accept produces a better answer and user clicks "Update thread"
- **THEN** the existing channel post is updated with the new answer

#### Scenario: Post new reply in channel
- **WHEN** refinement after accept produces additional information
- **THEN** user can choose to post it as a new reply in the channel thread
