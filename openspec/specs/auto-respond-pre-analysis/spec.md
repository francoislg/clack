# auto-respond-pre-analysis Specification

## Purpose
Lightweight Claude-based semantic filtering step for auto-respond rules. Evaluated after static matching and before full response, using a fast Haiku call to determine if a matched message is worth responding to.

## Requirements

### Requirement: Pre-Analysis Evaluation

The system SHALL support an optional pre-analysis step for auto-respond rules that evaluates message relevance using a lightweight Claude call before triggering a full response.

#### Scenario: Pre-analysis enabled and message passes
- **WHEN** a message matches a rule that has a non-empty `preAnalysisContext` field
- **THEN** the system makes a single-turn Claude Haiku call with `tools: []`, `maxTurns: 1`, and no MCP servers
- **AND** the system prompt instructs Claude to evaluate whether Clack should respond, given the admin-provided context
- **AND** the user prompt contains the message text
- **AND** if Claude responds with "yes", the system proceeds with the normal `processMessage()` flow

#### Scenario: Pre-analysis enabled and message rejected
- **WHEN** a message matches a rule that has a non-empty `preAnalysisContext` field
- **AND** Claude responds with "no"
- **THEN** the system skips the message silently
- **AND** does NOT call `processMessage()`

#### Scenario: Pre-analysis not configured
- **WHEN** a message matches a rule that has no `preAnalysisContext` field (or it is empty)
- **THEN** the system proceeds directly to `processMessage()` without any pre-analysis call

#### Scenario: Pre-analysis response parsing
- **WHEN** Claude returns a pre-analysis response
- **THEN** the system extracts the first word of the response text
- **AND** treats "yes" (case-insensitive) as approval
- **AND** treats any other response as rejection

### Requirement: Pre-Analysis Error Handling

The system SHALL fail-closed on pre-analysis errors, skipping the message silently.

#### Scenario: Pre-analysis call fails
- **WHEN** a pre-analysis Claude call throws an error (network error, timeout, rate limit, etc.)
- **THEN** the system skips the message silently
- **AND** does NOT call `processMessage()`
- **AND** logs the error at debug level with rule ID and channel

#### Scenario: Pre-analysis timeout
- **WHEN** a pre-analysis Claude call does not complete within a reasonable time
- **THEN** the system skips the message silently via the same fail-closed behavior

### Requirement: Pre-Analysis Logging

The system SHALL log pre-analysis decisions at debug level for troubleshooting.

#### Scenario: Log pre-analysis decision
- **WHEN** a pre-analysis call completes (success or failure)
- **THEN** the system logs at debug level: rule ID, channel ID, verdict (yes/no/error), and a brief excerpt of the reasoning if available

#### Scenario: No logging when pre-analysis not configured
- **WHEN** a rule does not have `preAnalysisContext` set
- **THEN** no pre-analysis logging occurs
