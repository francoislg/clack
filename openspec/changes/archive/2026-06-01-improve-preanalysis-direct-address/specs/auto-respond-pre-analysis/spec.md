## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Thread Reply Pre-Analysis

The system SHALL run pre-analysis on thread replies in threads with existing active sessions, using thread history as context and a built-in filtering criteria that includes disengagement detection. When a reply has no text but contains image uploads, the system SHALL synthesize a textual image-metadata placeholder and run pre-analysis normally. The `"stop"` verdict SHALL be reserved for explicit sign-offs or a clear topic change with no bot involvement across several messages; a serious/technical thread tone or a thread merely going quiet SHALL NOT by itself produce `"stop"`.

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

#### Scenario: Stop reserved for explicit sign-off or topic change

- **WHEN** thread reply pre-analysis runs
- **THEN** the classifier prompt instructs that `"stop"` is chosen only for an explicit sign-off (e.g. "thanks, all set", "closing this out") or a clear topic change with no bot involvement across several messages
- **AND** the prompt instructs that a serious/technical tone or a thread merely going quiet is NOT by itself a reason to return `"stop"`
- **AND** distinguishes `"stop"` (the bot should disengage the thread) from `"skip"` (this message isn't for the bot, but the thread stays engaged)
