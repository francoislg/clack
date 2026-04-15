## ADDED Requirements

### Requirement: Required Tools Gate on submit_response

The `submit_response` tool SHALL refuse delivery when the current session was configured with one or more `requiredTools` and any of them has not been recorded as called at least once during the run. Required tools are identified by their full MCP-visible name (e.g., `mcp__trivia__submit_answers`). A tool counts as "called" as soon as it appears in the session's `ToolCallRecorder` history, regardless of whether that call succeeded or returned an error.

#### Scenario: No required tools configured

- **WHEN** `submit_response` is called and the session context has no `requiredTools` (undefined or empty array)
- **THEN** the gate is bypassed
- **AND** the tool proceeds with its existing validation (staged intents, block validation, `post_to` dedup, etc.)

#### Scenario: All required tools were called

- **GIVEN** the session was configured with `requiredTools: ["mcp__trivia__submit_answers"]`
- **AND** the tool-call recorder history contains at least one entry with `tool === "mcp__trivia__submit_answers"`
- **WHEN** Claude calls `submit_response`
- **THEN** the gate passes
- **AND** the tool proceeds with its existing validation and delivery

#### Scenario: A required tool was not called

- **GIVEN** the session was configured with `requiredTools: ["mcp__trivia__submit_answers"]`
- **AND** the tool-call recorder history contains no entry with `tool === "mcp__trivia__submit_answers"`
- **WHEN** Claude calls `submit_response`
- **THEN** the tool returns an error result describing the missing tool(s) by exact name (e.g., `"Cannot submit response yet. The following required tool(s) have not been called during this run: mcp__trivia__submit_answers. Call them before submitting."`)
- **AND** does NOT call the deliver callback
- **AND** does NOT record the response as delivered in `responseCapture`
- **AND** the error is recorded via `recordError` so it appears in the tool-call history

#### Scenario: Multiple required tools — some missing

- **GIVEN** the session was configured with `requiredTools: ["mcp__trivia__submit_answers", "mcp__trivia__save_question"]`
- **AND** only `mcp__trivia__submit_answers` appears in the recorder history
- **WHEN** Claude calls `submit_response`
- **THEN** the error result lists only the missing tool name(s) (e.g., `mcp__trivia__save_question`)
- **AND** does not mention tools that were already called

#### Scenario: Required tool was called and returned an error

- **GIVEN** the session was configured with `requiredTools: ["mcp__trivia__submit_answers"]`
- **AND** the recorder contains an entry for `mcp__trivia__submit_answers` whose result is an error
- **WHEN** Claude calls `submit_response`
- **THEN** the gate passes (the tool was called, which is the sole requirement)
- **AND** the tool proceeds with its existing validation and delivery

#### Scenario: Gate runs before skip-response validation

- **WHEN** `submit_response` is called with `skip_response: true` and the session has unmet `requiredTools`
- **THEN** the gate blocks delivery regardless of skip mode
- **AND** the error returned identifies the missing required tool(s)

### Requirement: Required Tools Supplied via Session Context

The `requiredTools` list SHALL be provided per-session through the processing context pipeline (`ProcessMessageParams` → `ProcessingContext` → `QueryToolContext`), threaded into `SubmitResponseDeps`. It is not global state and not plugin-owned.

#### Scenario: Cron trigger populates required tools

- **WHEN** a cron job with `requiredTools: ["mcp__trivia__submit_answers"]` fires
- **THEN** the scheduler passes that list into `processMessage` as `ProcessMessageParams.requiredTools`
- **AND** the list flows through to the `submit_response` tool's gating logic for that session

#### Scenario: Non-cron triggers pass the field through unchanged

- **WHEN** a DM, mention, reaction, or auto-respond trigger invokes `processMessage` without supplying `requiredTools`
- **THEN** the field remains undefined
- **AND** the gate is bypassed for that session

#### Scenario: Unknown tool name in requiredTools is diagnosable

- **GIVEN** a session is configured with `requiredTools: ["mcp__typo__notatool"]`
- **AND** no tool with that name exists in the session's available tools
- **WHEN** query tool assembly detects the mismatch
- **THEN** the system logs a warning identifying the unknown required tool name
- **AND** the session still runs (assembly does not fail)
- **AND** the gate will block `submit_response` indefinitely for this session — the unknown tool cannot be called, so the gate cannot be satisfied
- **AND** each `submit_response` attempt returns the gate error listing the unknown tool name, which surfaces the misconfiguration via Claude's error feedback and via the operator-visible warning log
