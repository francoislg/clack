## ADDED Requirements

### Requirement: Thread Timestamp Surfaced for Direct-Posting Tools

The system SHALL surface the session's thread timestamp value in the delivery context for thread-bearing triggers, so that tools which post directly to Slack (e.g. `generate_image`'s `filesUploadV2` upload) can route their output into the conversation's thread rather than the channel root. The delivery context SHALL also describe that direct-posting tools should pass this thread timestamp to target the thread.

This is distinct from `submit_response`, whose channel/thread routing is supplied by bot infrastructure; direct-posting tools depend on Claude to supply the destination, so the destination value MUST be present in the prompt.

#### Scenario: Thread reaction trigger surfaces thread timestamp

- **WHEN** session has `triggerType: "reactions"`, `dmChannel` is NOT set, and a `threadTs` is present
- **THEN** the delivery context includes the session's `threadTs` value
- **AND** states that tools posting directly to Slack should pass that thread timestamp to post into the current thread

#### Scenario: Mention trigger surfaces thread timestamp

- **WHEN** session has `triggerType: "mentions"` and a `threadTs` is present
- **THEN** the delivery context includes the session's `threadTs` value
- **AND** states that tools posting directly to Slack should pass that thread timestamp to post into the current thread

#### Scenario: Thread-reply trigger surfaces thread timestamp

- **WHEN** session has `triggerType: "threadReply"` and a `threadTs` is present
- **THEN** the delivery context includes the session's `threadTs` value
- **AND** states that tools posting directly to Slack should pass that thread timestamp to post into the current thread

#### Scenario: Auto-respond trigger surfaces thread timestamp

- **WHEN** session has `triggerType: "autoRespond"` and a `threadTs` is present
- **THEN** the delivery context includes the session's `threadTs` value
- **AND** states that tools posting directly to Slack should pass that thread timestamp to post into the current thread

#### Scenario: No thread timestamp available

- **WHEN** the session has no `threadTs` (e.g. DM, auto-respond with no thread, or channelless scheduled run)
- **THEN** the delivery context does NOT emit a thread timestamp line
- **AND** existing delivery-context behavior for that trigger is unchanged
