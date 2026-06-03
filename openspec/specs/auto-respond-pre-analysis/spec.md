# auto-respond-pre-analysis Specification

## Purpose
Lightweight Claude-based semantic filtering step for auto-respond rules. Evaluated after static matching and before full response, using a single-turn Sonnet call with conversation-aware context to determine if a matched message is worth responding to.
## Requirements

### Requirement: Level-Keyed Classifier Policy

The pre-analysis classifier (`runPreAnalysis`) SHALL accept the session's attention level and select a POLICY block that governs the lean and tie-breakers, while keeping the shared scaffolding (direct-address override, thread-tone assessment, temporal-proximity signal, output format) identical across levels. The `"low"` policy SHALL reproduce the prior conservative behavior verbatim. The `"medium"` policy SHALL lean toward responding when a message is plausibly relevant. The `"high"` policy SHALL respond to nearly everything, skipping only unmistakable other-user side-talk. The `"stop"` verdict SHALL be offered to the classifier ONLY under the `"low"` policy. The `"always"` level SHALL NOT call the classifier at all (handled by the `attention-level` capability's short-circuit).

#### Scenario: Low policy preserves conservative behavior

- **WHEN** `runPreAnalysis` runs with level `"low"`
- **THEN** the policy defaults to `"skip"`, prefers skip over respond, and prefers skip over stop
- **AND** the verdict space is `respond | skip | stop`

#### Scenario: Medium policy leans toward respond

- **WHEN** `runPreAnalysis` runs with level `"medium"`
- **THEN** the policy responds when the message is plausibly relevant to the thread or the bot's last answer
- **AND** the verdict space is `respond | skip` (no `stop`)

#### Scenario: High policy responds to nearly everything

- **WHEN** `runPreAnalysis` runs with level `"high"`
- **THEN** the policy responds unless the message is unmistakable other-user side-talk
- **AND** the verdict space is `respond | skip` (no `stop`)

#### Scenario: Stop reserved to the low policy

- **WHEN** `runPreAnalysis` runs with level `"medium"` or `"high"`
- **THEN** the classifier prompt does NOT offer a `"stop"` verdict
- **AND** the thread cannot be disengaged by the classifier at that level

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
- **AND** the caller is responsible for setting `attentionLevel = "off"` on the session

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

### Requirement: Direct-Address Override

The pre-analysis classifier SHALL treat a message that addresses the bot by name in plain text, or that is an imperative or question only meaningful when aimed at the bot, as DIRECTED AT THE BOT. A directed message SHALL NOT resolve to `"skip"`; its verdict SHALL instead follow the message's intent among the engaged verdicts. This override SHALL take priority over thread-tone assessment. The override applies to both the tri-state gate (`runPreAnalysis`) and the active-run gate (`runActiveRunPreAnalysis`).

#### Scenario: By-name request resolves to respond

- **WHEN** a thread reply names the bot in plain text and contains a request or question aimed at it (e.g. "Come on Clack, you can do it using a worker", "Clack can you retry?")
- **THEN** the classifier returns `"respond"`
- **AND** the verdict is reached regardless of whether the thread tone reads as serious/technical

#### Scenario: By-name sign-off resolves to stop

- **WHEN** a thread reply names the bot in plain text and is an explicit sign-off or stop instruction (e.g. "Clack, stop", "ok Clack we're done")
- **THEN** the classifier returns `"stop"`
- **AND** the caller applies the existing disengagement side-effect

#### Scenario: Directed message is never skipped

- **WHEN** a message is determined to be directed at the bot (by-name or bot-only imperative/question)
- **THEN** the classifier returns one of the engaged verdicts (`"respond"` or `"stop"`)
- **AND** never returns `"skip"`

#### Scenario: Active-run gate treats directed follow-up as append

- **WHEN** a run is already live for the thread and a follow-up names the bot or is a bot-directed request/clarification
- **THEN** `runActiveRunPreAnalysis` returns `"append"`
- **AND** does not return `"skip"`

#### Scenario: Non-directed ambient chatter still skips

- **WHEN** a message is between other users, is noise, or merely mentions the bot's name without addressing it (e.g. "I'll ask Clack about that tomorrow")
- **THEN** the direct-address override does NOT apply
- **AND** the default `"skip"` behavior for ambient chatter is preserved

### Requirement: Temporal Proximity Signal

The pre-analysis classifier SHALL receive the elapsed time since the bot's most recent message in the thread, when such a message exists, and SHALL treat a shorter elapsed time as a stronger lean toward engagement (`"respond"` / `"append"`). The lean SHALL decay gradually as the elapsed time grows; elapsed time alone SHALL NEVER be sufficient grounds to return `"skip"` or `"stop"`. The signal applies to both gate variants.

#### Scenario: Elapsed time computed and injected

- **WHEN** the thread history contains at least one prior bot message
- **THEN** the system computes the seconds between the incoming message and the bot's most recent message
- **AND** injects a human-readable elapsed-time line into the classifier prompt

#### Scenario: No prior bot message in thread

- **WHEN** the thread history contains no prior bot message
- **THEN** the elapsed-time parameter is omitted
- **AND** no elapsed-time line is rendered in the prompt

#### Scenario: Short gap strengthens engagement lean

- **WHEN** an incoming message arrives shortly after the bot's last message in the thread
- **THEN** the classifier prompt leans strongly toward `"respond"` (or `"append"` in the active-run gate)

#### Scenario: Long gap does not by itself disengage

- **WHEN** an incoming message arrives a long time after the bot's last message (e.g. days later)
- **AND** the message is otherwise plausibly a reply to the bot
- **THEN** the elapsed time alone does NOT cause a `"skip"` or `"stop"` verdict

### Requirement: Thread Reply Pre-Analysis

The system SHALL run pre-analysis on thread replies in threads with engaged sessions (`attentionLevel !== "off"`), using thread history as context and a level-keyed policy (see "Level-Keyed Classifier Policy"). When a reply has no text but contains image uploads, the system SHALL synthesize a textual image-metadata placeholder and run pre-analysis normally. The `"stop"` verdict SHALL be reachable ONLY when the session level is `"low"`, and SHALL be reserved for explicit sign-offs or a clear topic change with no bot involvement across several messages; a serious/technical thread tone or a thread merely going quiet SHALL NOT by itself produce `"stop"`. A session at level `"always"` SHALL skip pre-analysis entirely and proceed to `processMessage()`.

#### Scenario: Thread reply passes pre-analysis

- **WHEN** a non-bot message arrives in a thread with an existing Clack session
- **AND** the session has `attentionLevel !== "off"` and is not `"always"`
- **AND** the message has non-empty text OR contains one or more supported image uploads
- **THEN** the system fetches up to 15 recent thread replies (excluding the parent message and the current message) via `conversations.replies`
- **AND** uses the last 10 as conversation context
- **AND** resolves @mentions to display names
- **AND** makes a pre-analysis call with the session level's policy
- **AND** if Claude responds with "respond", the system proceeds with `processMessage()`

#### Scenario: Always level skips pre-analysis

- **WHEN** a non-bot message arrives in a thread whose session has `attentionLevel === "always"`
- **THEN** the system does NOT make a pre-analysis call
- **AND** proceeds directly to `processMessage()`

#### Scenario: Thread reply rejected by pre-analysis

- **WHEN** a non-bot message arrives in a thread with an engaged session
- **AND** pre-analysis responds with "skip"
- **THEN** the system does NOT call `processMessage()`
- **AND** no response is posted

#### Scenario: Thread reply triggers disengagement only at low

- **WHEN** a non-bot message arrives in a thread with a `"low"` session
- **AND** pre-analysis responds with "stop"
- **THEN** the system sets `attentionLevel = "off"` on the session
- **AND** persists the session to disk
- **AND** does NOT call `processMessage()`

#### Scenario: Thread reply with image-only (no text)

- **WHEN** a message arrives in a thread with an engaged session
- **AND** the message has empty or undefined text
- **AND** the message contains one or more supported image uploads
- **THEN** the system synthesizes a pre-analysis message text of the form `[image: <filename> (file_id: <id>)]` for each image, joined on newlines, matching the prompt builder's attachment format
- **AND** runs pre-analysis with that synthesized text as the message, using the normal thread history and context
- **AND** respects the verdict allowed by the session level

#### Scenario: Thread reply with no text and no files

- **WHEN** a message arrives in a thread with an engaged session
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
- **AND** does NOT set `attentionLevel` to `"off"` (an error is not a disengagement signal)
- **AND** logs the error at warn level

#### Scenario: Stop reserved for explicit sign-off or topic change

- **WHEN** thread reply pre-analysis runs at level `"low"`
- **THEN** the classifier prompt instructs that `"stop"` is chosen only for an explicit sign-off (e.g. "thanks, all set", "closing this out") or a clear topic change with no bot involvement across several messages
- **AND** the prompt instructs that a serious/technical tone or a thread merely going quiet is NOT by itself a reason to return `"stop"`
- **AND** distinguishes `"stop"` (the bot should disengage the thread) from `"skip"` (this message isn't for the bot, but the thread stays engaged)

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

- **WHEN** a pre-analysis verdict is `"stop"` on a thread reply of an existing `"low"` session
- **THEN** `attentionLevel` is set to `"off"` on the session
- **AND** the verdict is NOT recorded on a new assistant message (no Claude call was made)
- **AND** the stop decision stays in stdout logs only

#### Scenario: Non-autoRespond sessions carry no preAnalysis field

- **WHEN** a session's trigger type is `"reactions"`, `"mentions"`, `"directMessages"`, or `"scheduled"` (excluding scheduled jobs that use `skipConditions`)
- **THEN** the `trigger.preAnalysis` field is absent
- **AND** appended `SessionAssistantMessage` entries do NOT carry `preAnalysis`
