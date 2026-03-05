## MODIFIED Requirements

### Requirement: DM Response Delivery
Deliver reaction-triggered answers via DM when user preference is `"dm"`. The DM flow uses streaming with plan blocks instead of posting separate investigation notice and answer messages.

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
Support natural thread-based refinement in DM threads. Users reply in the DM thread to ask follow-up questions or refine the answer.

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
Synthesize full DM conversation into clean answer for posting to the original channel thread.

#### Scenario: Send to thread triggers synthesis
- **WHEN** user clicks "Send to thread" action button
- **THEN** the system synthesizes the DM conversation into a clean answer and presents it for review

#### Scenario: Accept synthesis posts to channel
- **WHEN** user accepts the synthesized answer
- **THEN** the answer is posted as a visible message in the original channel thread

#### Scenario: Edit synthesis before accepting
- **WHEN** user clicks Edit on the synthesized answer
- **THEN** a modal opens allowing the user to modify the answer before posting

#### Scenario: Reject synthesis
- **WHEN** user clicks Reject on the synthesized answer
- **THEN** the synthesis is dismissed and the DM conversation continues

### Requirement: Post-Accept Continuation
Allow users to return to DM thread after answer posted to channel.

#### Scenario: User continues after accept
- **WHEN** a user sends a message in the DM thread after an answer was already posted to the channel
- **THEN** the system processes it as a new refinement with streaming

#### Scenario: Update existing channel post
- **WHEN** refinement after accept produces a better answer and user clicks "Update thread"
- **THEN** the existing channel post is updated with the new answer

#### Scenario: Post new reply in channel
- **WHEN** refinement after accept produces additional information
- **THEN** user can choose to post it as a new reply in the channel thread

## REMOVED Requirements

### Requirement: DM Reject Action (standalone)
**Reason**: The standalone "reject" action on regular DM responses (non-synthesis) is removed. Claude no longer includes a reject action in DM delivery context. The `clack_dm_reject` handler still exists and is used by the synthesis flow (Reject button on Accept/Edit/Reject) and post-accept flow (Cancel button) — those are part of the Synthesis requirement, not this one.
**Migration**: No action needed. DM conversations persist naturally; users can ignore responses.

### Requirement: NotifyHiddenThread Suppression
**Reason**: The `notifyHiddenThread` feature is removed entirely (it only applied to ephemeral responses). There are no hidden threads to notify about.
**Migration**: Remove `notifyHiddenThread` config option. Boot migration handles this.
