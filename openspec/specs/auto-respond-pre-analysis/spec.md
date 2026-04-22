# auto-respond-pre-analysis Specification

## Purpose
Lightweight Claude-based semantic filtering step for auto-respond rules. Evaluated after static matching and before full response, using a single-turn Sonnet call with conversation-aware context to determine if a matched message is worth responding to.
## Requirements
### Requirement: Pre-Analysis Evaluation

The system SHALL support an optional pre-analysis step for auto-respond rules that evaluates message relevance using a lightweight Claude call, returning a tri-state result: `"respond"`, `"skip"`, or `"stop"`.

#### Scenario: Pre-analysis enabled and message passes

- **WHEN** a message matches a rule that has a non-empty `preAnalysisContext` field
- **THEN** the system makes a single-turn Claude Sonnet call with `disallowedTools` blocking file/code tools, and `maxTurns: 1`
- **AND** the system prompt instructs Claude to evaluate whether the bot should respond, with explicit rules for directed messages, reply patterns, conversation context, and noise
- **AND** the user prompt includes the message text with resolved @mentions, the message author's display name, the channel name, and attributed recent channel history
- **AND** if Claude responds with "respond", the system proceeds with the normal `processMessage()` flow

#### Scenario: Pre-analysis enabled and message rejected

- **WHEN** a message matches a rule that has a non-empty `preAnalysisContext` field
- **AND** Claude responds with "skip" or any response not containing "respond" or "stop"
- **THEN** the system skips the message silently
- **AND** does NOT call `processMessage()`

#### Scenario: Pre-analysis returns stop

- **WHEN** a message is evaluated by pre-analysis
- **AND** Claude responds with "stop"
- **THEN** the system returns `"stop"` to the caller
- **AND** the caller is responsible for setting `autoResponseActive = false` on the session

#### Scenario: Pre-analysis not configured

- **WHEN** a message matches a rule that has no `preAnalysisContext` field (or it is empty)
- **THEN** the system proceeds directly to `processMessage()` without any pre-analysis call

#### Scenario: Pre-analysis context includes channel name

- **WHEN** a pre-analysis call is made
- **THEN** the classifier prompt includes the channel name (e.g., `Channel: #security-compliance`)
- **AND** the channel name is resolved via the channel cache

#### Scenario: Pre-analysis response parsing

- **WHEN** Claude returns a pre-analysis response
- **THEN** the system checks the lowercased response text for the words "respond", "skip", or "stop"
- **AND** treats "respond" as approval (proceed with response)
- **AND** treats "stop" as disengagement signal (caller should deactivate tracking)
- **AND** treats anything else (including "skip" and unrecognized text) as rejection (skip the message)

### Requirement: Thread Reply Pre-Analysis

The system SHALL run pre-analysis on thread replies in threads with existing active sessions, using thread history as context and a built-in filtering criteria that includes disengagement detection. When a reply has no text but contains image uploads, the system SHALL synthesize a textual image-metadata placeholder and run pre-analysis normally.

#### Scenario: Thread reply passes pre-analysis

- **WHEN** a non-bot message arrives in a thread with an existing Clack session
- **AND** the session has `autoResponseActive === true`
- **AND** the message has non-empty text OR contains one or more supported image uploads
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

#### Scenario: Thread reply triggers disengagement

- **WHEN** a non-bot message arrives in a thread with an existing Clack session
- **AND** pre-analysis responds with "stop"
- **THEN** the system sets `autoResponseActive = false` on the session
- **AND** persists the session to disk
- **AND** does NOT call `processMessage()`

#### Scenario: Thread reply with image-only (no text)

- **WHEN** a message arrives in a thread with an existing Clack session
- **AND** the message has empty or undefined text
- **AND** the message contains one or more supported image uploads
- **THEN** the system synthesizes a pre-analysis message text of the form `[image: <filename> (file_id: <id>)]` for each image, joined on newlines, matching the prompt builder's attachment format
- **AND** runs pre-analysis with that synthesized text as the message, using the normal thread history and context
- **AND** respects the `respond`/`skip`/`stop` verdict the same way as text-bearing replies

#### Scenario: Thread reply with no text and no files

- **WHEN** a message arrives in a thread with an existing Clack session
- **AND** the message has empty or undefined text
- **AND** the message has no supported image uploads
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

#### Scenario: Thread pre-analysis error handling

- **WHEN** thread reply pre-analysis fails (network error, timeout, rate limit)
- **THEN** the system skips the message (fail-closed)
- **AND** does NOT set `autoResponseActive` to `false` (an error is not a disengagement signal)
- **AND** logs the error at warn level

#### Scenario: Thread pre-analysis context includes stop guidance

- **WHEN** thread reply pre-analysis runs
- **THEN** the classifier prompt includes guidance to return "stop" when the conversation has clearly moved on from the original topic and the bot is no longer needed
- **AND** distinguishes "stop" (conversation is over for the bot) from "skip" (this specific message isn't for the bot, but the thread is still relevant)

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

### Requirement: Pre-Analysis Persistence on Session

The system SHALL persist every autoRespond pre-analysis verdict that leads to a Claude call onto the session file, so post-hoc debugging can see the gate's decisions without correlating against stdout logs.

#### Scenario: Session-creating autoRespond verdict on trigger

- **WHEN** an autoRespond pre-analysis verdict is `"respond"` and the system creates a new session
- **THEN** the verdict text is written to `trigger.preAnalysis` on that session's `context.json`
- **AND** the trigger's `type` is `"autoRespond"`

#### Scenario: Continuation verdict on assistant message

- **WHEN** a thread-reply pre-analysis verdict is `"respond"` for an existing session
- **AND** the resulting Claude turn produces an assistant message (whether delivered, skipped, or errored)
- **THEN** the verdict text is written as `preAnalysis` on the appended `SessionAssistantMessage`

#### Scenario: Skipped sessions are not persisted

- **WHEN** a pre-analysis verdict is `"skip"` (or anything other than `"respond"`) and no Claude call is made
- **THEN** no session file is created (for brand-new sessions)
- **AND** no assistant message is appended (for existing sessions)
- **AND** the verdict is NOT written to disk — the skip decision stays in stdout logs only

#### Scenario: Stop verdict captured on disengagement

- **WHEN** a pre-analysis verdict is `"stop"` on a thread reply of an existing session
- **THEN** `autoResponseActive` is set to `false` on the session
- **AND** the verdict is NOT recorded on a new assistant message (no Claude call was made)
- **AND** the stop decision stays in stdout logs only

#### Scenario: Non-autoRespond sessions carry no preAnalysis field

- **WHEN** a session's trigger type is `"reactions"`, `"mentions"`, `"directMessages"`, or `"scheduled"` (excluding scheduled jobs that use `skipConditions`)
- **THEN** the `trigger.preAnalysis` field is absent
- **AND** appended `SessionAssistantMessage` entries do NOT carry `preAnalysis`

