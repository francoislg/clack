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

#### Scenario: Auto post_to on explicit request
- **WHEN** a DM thread refinement explicitly asks to share the answer
- **THEN** Claude includes `post_to` with `auto: true` in the response actions

### Requirement: Synthesis and Send to Thread
The system SHALL post per-button content when the user clicks a "Post to thread" button (renamed from "Send to thread"), reading the content entry persisted at button creation time.

#### Scenario: Post to thread posts button-specific content

- **WHEN** the user clicks a "Post to thread" button
- **THEN** the handler decodes the content entry ID from the button value
- **AND** looks up the content entry from `session.snapshots`
- **AND** posts that specific content to the target channel thread
- **AND** confirms delivery in the DM thread

#### Scenario: Post to thread with missing content entry

- **WHEN** the user clicks a "Post to thread" button but the content entry is not found in the session
- **THEN** the handler logs an error
- **AND** does NOT post to the channel
- **AND** does NOT fall back to `session.lastAnswer` or `session.lastResponse`

#### Scenario: Post to thread with explicit target

- **WHEN** the button value includes explicit `channel` and `thread_ts`
- **THEN** the content is posted to that specific channel and thread
- **AND** the origin channel/thread fallback chain is not used

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
