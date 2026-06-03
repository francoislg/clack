## ADDED Requirements

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

## MODIFIED Requirements

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
