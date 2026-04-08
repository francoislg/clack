# auto-respond-pre-analysis Specification

## Purpose
Lightweight Claude-based semantic filtering step for auto-respond rules. Evaluated after static matching and before full response, using a single-turn Sonnet call with conversation-aware context to determine if a matched message is worth responding to.

## Requirements

### Requirement: Pre-Analysis Evaluation

The system SHALL support an optional pre-analysis step for auto-respond rules that evaluates message relevance using a lightweight Claude call before triggering a full response.

#### Scenario: Pre-analysis enabled and message passes
- **WHEN** a message matches a rule that has a non-empty `preAnalysisContext` field
- **THEN** the system makes a single-turn Claude Sonnet call with `disallowedTools` blocking file/code tools, and `maxTurns: 1`
- **AND** the system prompt instructs Claude to evaluate whether the bot should respond, with explicit rules for directed messages, reply patterns, conversation context, and noise
- **AND** the user prompt includes the message text with resolved @mentions, the message author's display name, the channel name, and attributed recent channel history
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

### Requirement: Thread Reply Pre-Analysis

The system SHALL run pre-analysis on thread replies in threads with existing sessions, using thread history as context and a built-in filtering criteria.

#### Scenario: Thread reply passes pre-analysis
- **WHEN** a non-bot message arrives in a thread with an existing Clack session
- **AND** the message has non-empty text
- **THEN** the system fetches up to 15 recent thread replies (excluding the parent message and the current message) via `conversations.replies`
- **AND** uses the last 10 as conversation context
- **AND** resolves @mentions to display names
- **AND** makes a pre-analysis call with a built-in thread-specific filtering criteria focused on detecting genuine follow-up questions vs. noise
- **AND** if Claude responds with "respond", the system proceeds with `processMessage()`

#### Scenario: Thread reply rejected by pre-analysis
- **WHEN** a non-bot message arrives in a thread with an existing Clack session
- **AND** pre-analysis responds with "skip"
- **THEN** the system does NOT call `processMessage()`
- **AND** no response is posted

#### Scenario: Thread reply with empty text
- **WHEN** a message arrives in a thread with an existing Clack session
- **AND** the message has no text (empty or undefined)
- **THEN** the system skips the message without running pre-analysis

#### Scenario: Thread pre-analysis uses shared context
- **WHEN** thread reply pre-analysis runs
- **THEN** the shared pre-analysis context files (from `data/configuration/pre-analysis/` and `data/default_configuration/pre-analysis/`) are loaded and included
- **AND** the channel name is included in the classifier prompt

#### Scenario: Change workflow commands bypass thread pre-analysis
- **WHEN** a thread reply arrives in a thread with an active change (status `pr_created`)
- **AND** the message text matches a change workflow command (e.g., "merge", "ship it", "close")
- **THEN** the system does NOT run pre-analysis
- **AND** returns null (handled by the change workflow)

#### Scenario: Thread pre-analysis context is built-in
- **WHEN** thread reply pre-analysis runs
- **THEN** the filtering criteria is a built-in constant (not from a rule's `preAnalysisContext` field)
- **AND** instructs the classifier to respond only to genuine follow-up questions or requests for clarification
- **AND** instructs the classifier to skip acknowledgments, noise, and conversation between other people

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
