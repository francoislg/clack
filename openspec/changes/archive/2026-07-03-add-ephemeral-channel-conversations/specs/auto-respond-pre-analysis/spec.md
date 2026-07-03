# auto-respond-pre-analysis (delta)

## ADDED Requirements

### Requirement: Channel Continuation Pre-Analysis

The system SHALL provide a channel-continuation pre-analysis variant, alongside the standard and active-run variants, used exclusively by ephemeral channel-conversation rules. Its prompt SHALL treat unrelatedness as the default prior (the question is "is this message part of the conversation the bot's post started?"), SHALL include the anchor post's text verbatim, the recent channel history, the message author, and the elapsed time since the bot's last message in the channel, and SHALL return `respond`, `skip`, or `stop` keyed by the rule's current attention level.

#### Scenario: Flipped prior versus thread gate
- **WHEN** the channel-continuation variant evaluates a message that merely appears in the same channel without engaging the anchor topic
- **THEN** the verdict is `skip` (unrelated is the default in a channel), whereas the thread gate would lean toward relatedness for the same ambiguity

#### Scenario: Elapsed time as a decaying lean
- **WHEN** a message arrives shortly after the bot's channel post
- **THEN** the short gap weighs toward `respond` for ambiguous messages
- **AND** a long gap (including past the rule's expiry) requires clear topical linkage to the anchor text to yield `respond`

#### Scenario: Level-keyed eagerness
- **WHEN** the rule's current attention level is `low`
- **THEN** only direct address or unmistakable continuation of the anchor conversation yields `respond`

#### Scenario: Classifier failure fails closed
- **WHEN** the channel-continuation classifier call errors
- **THEN** the system does not respond and leaves the rule unchanged (no ratchet, no deletion)
