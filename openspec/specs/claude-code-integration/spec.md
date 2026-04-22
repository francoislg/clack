# claude-code-integration Specification

## Purpose
TBD - created by archiving change add-slack-reaction-bot. Update Purpose after archive.
## Requirements
### Requirement: Claude Code Subprocess Invocation
The system SHALL use the Claude Agent SDK for answer generation requests via the `clackSession` wrapper function. The `askClaude()` function now supports session resumption across turns and an `onEvent` callback for real-time streaming of tool call progress.

#### Scenario: Query via clackSession wrapper
- **WHEN** answer generation is requested
- **THEN** the system calls `clackSession()` (not the SDK `query()` directly)
- **AND** passes the question and context as the prompt
- **AND** configures `cwd` to point to the repositories directory
- **AND** loads external MCP servers asynchronously (awaiting token generation if needed)
- **AND** builds the in-process `clack` MCP server with query context
- **AND** passes both external and clack MCP servers in `mcpServers`
- **AND** captures the `submit_response` tool call output as the structured response

#### Scenario: Session-start MCP set is always-on only

- **GIVEN** the registry marks `clack` and `github` as `alwaysLoad: true` and 7 other servers as `alwaysLoad: false`
- **WHEN** a new SDK session is initiated from `src/claude/index.ts`
- **THEN** the `mcpServers` passed to `query()` options contains only `clack` and `github`
- **AND** none of the non-always-on servers' tool schemas are included in the session's initial context

#### Scenario: Resumed session re-attaches previously attached integrations

- **GIVEN** a prior turn of the session called `attach_integration("metabase")` successfully
- **AND** `session.attachedIntegrations` contains `"metabase"`
- **WHEN** the next turn resumes the SDK session via `resume: sdkSessionId`
- **THEN** before streaming the first user message of the resumed turn, Clack calls `query.setMcpServers(alwaysOn ∪ { metabase })`
- **AND** `metabase` is available on the first assistant turn of the resumed session

#### Scenario: Resumed session with no prior attachments

- **GIVEN** `session.attachedIntegrations` is empty (no prior `attach_integration` calls succeeded)
- **WHEN** the next turn resumes the SDK session
- **THEN** Clack calls `query.setMcpServers(alwaysOn)` (always-on set only, no integrations) before streaming the first user message
- **AND** the call is idempotent — no new tools arrive, no errors surface

#### Scenario: Resume re-attach partially fails

- **GIVEN** `session.attachedIntegrations` contains `"metabase"` and `"monday"`
- **AND** `monday`'s upstream MCP is unreachable at resume time
- **WHEN** the session resumes and calls `setMcpServers(alwaysOn ∪ { metabase, monday })`
- **THEN** the returned `errors` map contains `monday` with the connection error text
- **AND** `monday` is logged as a resume failure and dropped from `session.attachedIntegrations`
- **AND** the session continues with `metabase` still attached

#### Scenario: Attach latency visible in thinking indicator

- **WHEN** `attach_integration` calls `setMcpServers` and the attach takes noticeable time
- **THEN** the Slack thinking indicator reflects the in-progress state (e.g., `Attaching metabase…`)
- **AND** updates to the success or failure state once `setMcpServers` returns

#### Scenario: Session resumed on follow-up
- **WHEN** `askClaude()` is called for a session that has an `sdkSessionId`
- **THEN** the system passes the `sdkSessionId` as `resumeSessionId` to `clackSession()`
- **AND** Claude has access to the full conversation history from previous turns (tool calls, results, reasoning)

#### Scenario: SDK session ID captured on first query
- **WHEN** `askClaude()` is called for a session without an `sdkSessionId`
- **THEN** `clackSession()` starts a fresh SDK session
- **AND** the captured SDK session ID is stored on the Clack session via `onSessionId` callback

#### Scenario: Model configurable
- **WHEN** the system starts
- **THEN** it reads the model name from configuration
- **AND** passes it to the SDK for all queries

#### Scenario: onEvent callback for streaming
- **WHEN** `askClaude()` is called with an `onEvent` callback in options
- **THEN** the function emits `StreamEvent` objects as Claude executes
- **AND** `tool_start` events are emitted when `tool_use` blocks appear in the SDK message stream
- **AND** `tool_end` events are emitted when `tool_result` blocks appear
- **AND** the `taskId` field uses the SDK's `tool_use_id` to correlate start/end events

#### Scenario: onEvent callback is optional
- **WHEN** `askClaude()` is called without an `onEvent` callback
- **THEN** the function behaves identically to before (no streaming events emitted)
- **AND** the return type (`ClaudeResponse`) is unchanged

### Requirement: Filesystem Permission Enforcement
The system SHALL enforce read-only access to repositories by restricting allowed tools.

#### Scenario: Read-only repository access
- **WHEN** the Agent SDK query is invoked
- **THEN** the `allowedTools` option includes only `Read`, `Glob`, and `Grep`
- **AND** excludes `Write`, `Edit`, and `Bash`
- **AND** Claude can read files in cloned repositories
- **AND** Claude cannot modify any files

### Requirement: Non-Technical Response Style
The system SHALL instruct Claude Code to provide answers in broad, non-technical language suitable for non-developers by default.

#### Scenario: System prompt enforces non-technical style
- **WHEN** Claude Code subprocess is spawned
- **THEN** the system prompt instructs Claude to explain like talking to a teammate who doesn't code
- **AND** never include file paths, line numbers, function names, table/field names, or code snippets
- **AND** focus on WHAT is happening and WHY, not HOW it's implemented

#### Scenario: Technical details available only on explicit request
- **WHEN** a user explicitly asks for "more details", "technical info", or "specifics"
- **THEN** Claude Code may include code references and technical explanations
- **AND** still prioritizes clarity over exhaustive technical accuracy

### Requirement: Multi-Repository Awareness
The system SHALL inform Claude Code about all configured repositories and their purposes.

#### Scenario: Repository list in system prompt
- **WHEN** Claude Code subprocess is spawned
- **THEN** the system prompt includes the list of available repositories
- **AND** each repository's name and description from config
- **AND** instructs Claude to determine which repo(s) are relevant to the question

#### Scenario: Claude selects relevant repository
- **WHEN** Claude Code processes a question
- **THEN** it determines which repository or repositories to search
- **AND** focuses its code exploration on the selected repo(s)

### Requirement: Session Context Continuation
The system SHALL pass previous conversation context to Claude Code for follow-up questions. When an SDK session is being resumed, only new messages since the last query are injected; otherwise, full thread context is provided. Thread-based replies replace refinement as a first-class concept.

#### Scenario: Refinement includes previous context
- **WHEN** a user replies in a thread (DM or channel)
- **AND** the session has no `sdkSessionId` (first query or legacy session)
- **THEN** the system fetches full thread context from Slack
- **AND** passes it to Claude as conversation history
- **AND** does NOT use a separate refinement mechanism

#### Scenario: Delta context on resumed session
- **WHEN** a user replies in a thread (DM or channel)
- **AND** the session has an `sdkSessionId` (resumed SDK session)
- **THEN** the system fetches only thread messages newer than `lastSeenThreadTs`
- **AND** injects only those messages as additional context in the prompt built by `buildPrompt()`
- **AND** Claude relies on SDK session memory for all prior conversation context

#### Scenario: Update preserves conversation history
- **WHEN** a user clicks Update to regenerate
- **THEN** the system passes the updated message/thread context along with any previous refinements
- **AND** Claude Code considers the full conversation history

### Requirement: Output Capture and Formatting
The system SHALL capture Claude's `submit_response` tool output and format it for Slack.

#### Scenario: Structured response from submit_response

- **WHEN** Claude calls `submit_response` during a query
- **THEN** the system captures the structured payload (sections and actions)
- **AND** uses the payload to render Slack blocks via the response renderer

#### Scenario: Fallback to raw text

- **WHEN** a query completes without Claude calling `submit_response`
- **THEN** the system falls back to the last assistant text output
- **AND** renders it as a plain section block with generic retry/reject actions

#### Scenario: Markdown to Slack formatting
- **WHEN** response sections contain markdown
- **THEN** the system converts markdown to Slack-compatible mrkdwn format
- **AND** preserves code blocks, lists, and emphasis

#### Scenario: Long responses split for Slack
- **WHEN** a section body exceeds Slack's 3000-character section block limit
- **THEN** the system splits the text at paragraph boundaries
- **AND** creates multiple section blocks


### Requirement: Autonomous Change Execution

The system SHALL support an autonomous change execution mode using `clackSession` for session continuity across change follow-ups. The `runClaudeInWorktree()` function now supports the same `onEvent` callback for streaming worker tool progress.

#### Scenario: Execute change with clackSession
- **WHEN** a change request is triggered by an authorized dev
- **THEN** the system builds worker tools via `buildClackTools()` with mode `execute`
- **AND** invokes `clackSession()` with a change-focused system prompt
- **AND** passes the `clack` MCP server in the `mcpServers` option
- **AND** allows default tools: `Read`, `Glob`, `Grep`, `Write`, `Edit`, `Bash`
- **AND** sets `cwd` to the worktree directory
- **AND** always disallows `Task` tool
- **AND** sets `permissionMode` to `bypassPermissions` with `allowDangerouslySkipPermissions: true`

#### Scenario: Change execution resumed on update follow-up
- **WHEN** an update request is made for an existing change ("fix tests", "address review comments", etc.)
- **AND** the change has a stored SDK session ID
- **THEN** the system passes the SDK session ID as `resumeSessionId` to `clackSession()`
- **AND** Claude has full context of its prior worktree work (what it implemented, what tests it ran, etc.)

#### Scenario: Change execution resumed on review follow-up
- **WHEN** a review follow-up is triggered (PR review feedback received)
- **AND** the change has a stored SDK session ID
- **THEN** the system passes the SDK session ID as `resumeSessionId` to `clackSession()`
- **AND** Claude can reference its prior implementation decisions when addressing review comments

#### Scenario: Change SDK session ID stored separately
- **WHEN** a change execution captures an SDK session ID
- **THEN** the ID is stored on the change state (e.g., `ChangePlan` or `ActiveChangeState`)
- **AND** is NOT stored on the main Q&A session's `sdkSessionId` field
- **AND** a single thread can have independent SDK sessions for Q&A and change execution

#### Scenario: Worktree sandbox enforcement
- **WHEN** Claude executes in change mode
- **THEN** all file operations are restricted to the worktree directory
- **AND** Bash commands run with `cwd` set to the worktree
- **AND** attempts to access files outside the worktree are blocked
- **AND** no access to parent directories, other repositories, or system paths

#### Scenario: Additional allowed tools from config
- **WHEN** `changesWorkflow.additionalAllowedTools` is configured
- **THEN** the system adds those tools to the allowed list
- **AND** merges them with the default allowed tools
- **AND** tools like `WebFetch`, `WebSearch` can be enabled this way

#### Scenario: Change system prompt references MCP tools
- **WHEN** the autonomous Claude instance is invoked
- **THEN** the system prompt instructs Claude to:
  - Analyze the change request
  - Explore the codebase to understand context
  - Implement the requested change
  - Run tests if available
  - Commit changes with a descriptive message
  - Push the branch using the `git_push` tool
  - Create a PR using the `ensure_pr` tool
  - Report progress and results using the `report_status` tool

#### Scenario: Execution timeout
- **WHEN** change execution exceeds the configured timeout (default 10 minutes)
- **THEN** the system aborts the query via `AbortController`
- **AND** checks session state to determine partial completion (e.g., committed but not pushed)

#### Scenario: Execution result from session state
- **WHEN** Claude completes execution
- **THEN** the orchestrator reads the session's `prUrl` and status to determine outcome
- **AND** does NOT parse text markers from Claude's output

#### Scenario: Git author attribution
- **WHEN** a change execution is invoked
- **THEN** the system passes `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, and `GIT_COMMITTER_EMAIL` via the SDK `env` option
- **AND** spreads `process.env` to preserve the existing environment

#### Scenario: Worktree-aware Claude invocation
- **WHEN** any Claude invocation targets a worktree directory
- **THEN** the system SHALL use the worktree-aware invocation wrapper
- **AND** the wrapper refreshes the git remote authentication token before invoking the SDK
- **AND** the wrapper requires `repoName` and `worktreePath` as mandatory parameters
- **AND** direct `runClaude()` calls in worktree contexts are not permitted

#### Scenario: Auth refresh covers all worktree operations
- **GIVEN** the worktree-aware wrapper is used
- **WHEN** Claude is invoked for any worktree operation (execution, review, update, setup, intent detection)
- **THEN** the remote URL is updated with a fresh installation token
- **AND** this occurs regardless of whether the specific operation involves git push

#### Scenario: Worker onEvent callback
- **WHEN** `runClaude()` is called with an `onEvent` callback
- **THEN** the function emits `tool_start` events when `tool_use` blocks appear
- **AND** emits `tool_end` events when `tool_result` blocks appear (with error status if `is_error: true`)
- **AND** the caller (change workflow handlers) can wire these events to a `SlackStreamer` for live progress display

### Requirement: `runClaude` MCP Server Support

The system SHALL support passing MCP servers to the `runClaude()` function for worker invocations.

#### Scenario: MCP servers passed to Agent SDK
- **WHEN** `runClaude()` is called with an `mcpServers` option
- **THEN** the system passes the MCP servers to the Agent SDK `query()` call
- **AND** the Agent SDK makes the MCP tools available to Claude during execution

#### Scenario: MCP servers optional
- **WHEN** `runClaude()` is called without `mcpServers`
- **THEN** the system invokes the Agent SDK without MCP servers (backwards compatible)
- **AND** Claude has access only to the standard allowed tools

### Requirement: PR Template Resolution

The system SHALL resolve PR templates from multiple sources in priority order.

#### Scenario: Template from repository
- **WHEN** preparing to create a PR
- **THEN** the system checks the worktree for templates in order:
  - `.github/PULL_REQUEST_TEMPLATE.md`
  - `.github/pull_request_template.md`
  - `docs/PULL_REQUEST_TEMPLATE.md`
- **AND** uses the first template found

#### Scenario: Template from Clack data directory
- **GIVEN** no template found in the repository
- **WHEN** preparing to create a PR
- **THEN** the system checks for `data/default_configuration/pr-template.md`
- **AND** uses it if present

#### Scenario: Built-in default template
- **GIVEN** no template found in repo or data directory
- **WHEN** preparing to create a PR
- **THEN** the system uses a minimal built-in template with:
  - Summary section
  - Changes section
  - Test plan section

### Requirement: Utility Queries Use clackQuery

The system SHALL use `clackQuery()` for all fire-and-forget Claude invocations that do not participate in multi-turn conversations.

#### Scenario: Summarization uses clackQuery
- **WHEN** `summarizeForSlack()` is called to condense text
- **THEN** it uses `clackQuery()` which sets `persistSession: false`
- **AND** no SDK session file is created on disk

#### Scenario: Error analysis uses clackQuery
- **WHEN** `analyzeError()` is called to generate a user-friendly error explanation
- **THEN** it uses `clackQuery()` which sets `persistSession: false`

#### Scenario: Pre-analysis uses clackQuery
- **WHEN** `shouldAutoRespond()` is called to classify a message
- **THEN** it uses `clackQuery()` which sets `persistSession: false`

#### Scenario: MCP server test uses clackQuery
- **WHEN** `testMcpServer()` is called to verify MCP connectivity
- **THEN** it uses `clackQuery()` which sets `persistSession: false`

#### Scenario: Migration engine uses clackQuery
- **WHEN** the migration engine runs a Claude-powered migration
- **THEN** it uses `clackQuery()` which sets `persistSession: false`
