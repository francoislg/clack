## Purpose
Lightweight Claude-based semantic filtering step for auto-respond rules. Evaluated after static matching and before full response, using a single-turn Sonnet call with conversation-aware context to determine if a matched message is worth responding to.

## MODIFIED Requirements

### Requirement: Pre-Analysis Evaluation

The system SHALL support an optional pre-analysis step for auto-respond rules that evaluates message relevance using a lightweight Claude call before triggering a full response.

#### Scenario: Pre-analysis enabled and message passes
- **WHEN** a message matches a rule that has a non-empty `preAnalysisContext` field
- **THEN** the system makes a single-turn Claude Sonnet call with `disallowedTools` blocking file/code tools, and `maxTurns: 1`
- **AND** the system prompt instructs Claude to evaluate whether the bot should respond, with explicit rules for directed messages, reply patterns, conversation context, and noise
- **AND** the user prompt includes the message text with resolved @mentions, the message author's display name, and attributed recent channel history
- **AND** if Claude responds with "respond", the system proceeds with the normal `processMessage()` flow

#### Scenario: Pre-analysis enabled and message rejected
- **WHEN** a message matches a rule that has a non-empty `preAnalysisContext` field
- **AND** Claude responds with "skip" or any response not containing "respond"
- **THEN** the system skips the message silently
- **AND** does NOT call `processMessage()`

#### Scenario: Pre-analysis not configured
- **WHEN** a message matches a rule that has no `preAnalysisContext` field (or it is empty)
- **THEN** the system proceeds directly to `processMessage()` without any pre-analysis call

#### Scenario: Pre-analysis context includes channel name
- **WHEN** a pre-analysis call is made
- **THEN** the classifier prompt includes the channel name (e.g., `Channel: #security-compliance`)
- **AND** the channel name is resolved via the channel cache

#### Scenario: Pre-analysis response parsing
- **WHEN** Claude returns a pre-analysis response
- **THEN** the system checks if the lowercased response text contains the word "respond"
- **AND** treats presence of "respond" as approval (proceed with response)
- **AND** treats absence of "respond" as rejection (skip the message)

### Requirement: Pre-Analysis Error Handling

The system SHALL fail-closed on pre-analysis errors, skipping the message silently.

#### Scenario: Pre-analysis call fails
- **WHEN** a pre-analysis Claude call throws an error (network error, timeout, rate limit, etc.)
- **THEN** the system skips the message silently
- **AND** does NOT call `processMessage()`
- **AND** logs the error at warn level

#### Scenario: Pre-analysis timeout
- **WHEN** a pre-analysis Claude call does not complete within a reasonable time
- **THEN** the system skips the message silently via the same fail-closed behavior

### Requirement: Pre-Analysis Logging

The system SHALL log pre-analysis decisions at debug level for troubleshooting.

#### Scenario: Log pre-analysis decision
- **WHEN** a pre-analysis call completes (success or failure)
- **THEN** the system logs at info/debug level: rule ID, channel ID, verdict (yes/no), and the result text

#### Scenario: No logging when pre-analysis not configured
- **WHEN** a rule does not have `preAnalysisContext` set
- **THEN** no pre-analysis logging occurs
