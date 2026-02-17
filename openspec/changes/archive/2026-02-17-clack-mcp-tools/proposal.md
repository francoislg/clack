## Why

Claude's responses are currently structured via XML-like tags (`<answer>`, `<change-request>`, `<resume-request>`, `<config-update>`) embedded in text output, parsed with regex, and routed through a priority chain. This approach is fragile (parsing failures, forgotten tags), offers no validation or error recovery (fire-and-forget), and forces large blocks of format documentation and dynamic state into the system prompt. Replacing this with in-process MCP tools via the Agent SDK's `createSdkMcpServer()` gives Claude structured tool calls with typed parameters, real-time validation with retry loops, and dynamic state querying — while dramatically simplifying the instruction system and enabling richer Slack interactions.

## What Changes

- **BREAKING**: Remove all XML tag formats (`<answer>`, `<change-request>`, `<resume-request>`, `<config-update>`) and their parsers
- **BREAKING**: Remove most instruction template variables (`REPOSITORIES_LIST`, `MCP_INTEGRATIONS`, `CHANGE_REQUEST_BLOCK`, `RESUMABLE_SESSIONS`, `CONFIG_UPDATE_BLOCK`, `AVAILABLE_VARIABLES`); retain only static identity variables like `BOT_NAME`
- Add in-process MCP tool server (`clack`) registered alongside external MCP servers, built per-query with session/user context via closures
- Add **query tools**: `list_repositories`, `find_sessions`, `find_changes`, `list_config_files` — Claude discovers state dynamically instead of receiving it in the prompt
- Add **action tools**: `propose_change`, `propose_config_update` — validate and stage intent (including existing worktree detection), return refs; Claude can retry on validation errors
- Add **change thread follow-up tools**: `request_review`, `request_merge`, `request_update`, `request_close` — replace `<follow-up-command>` XML tags with typed tool calls; available only in change thread context with active session
- Add **presentation tool**: `submit_response` — Claude provides structured sections and declares which actions (buttons) to show, replacing both the `<answer>` tag and the static 5-button layout
- Add **choice action type** in `submit_response` — Claude can present options as buttons (e.g., which repo, new vs existing branch) and resume after user selection, enabling multi-step conversational flows
- Add **followup action type** — Claude suggests pre-computed follow-up questions as clickable buttons
- Role-based feature gating moves from prompt content inclusion to tool availability (member gets `submit_response` only; dev adds action tools; admin adds config tools)
- Instruction files remain role-separated but shrink to behavioral guidance only (no format documentation, no state dumps)
- Slack block builder becomes a renderer of Claude's `submit_response` output instead of a static template

## Capabilities

### New Capabilities
- `clack-tools`: In-process MCP tool server definition, per-query builder with context closures, tool registry, and integration with Agent SDK's `createSdkMcpServer()`
- `clack-tool-response`: The `submit_response` presentation tool — structured sections, action declarations (accept, reject, edit, refine, followup, choice, change, config_update), and the Slack block rendering that maps tool output to Block Kit

### Modified Capabilities
- `claude-code-integration`: Remove "Structured Response Parsing" requirement (XML tags + parsers + priority routing); replace with tool-call-based response handling; update query options to register clack MCP server
- `instruction-variables`: Remove most variable definitions from registry; retain only static identity variables; simplify or remove `buildAvailableVariablesTable()`
- `instruction-system`: Simplify variable interpolation (fewer variables); instruction file content changes from format documentation to behavioral guidance
- `config-update-via-chat`: Replace `<config-update>` tag detection with `propose_config_update` tool + `submit_response` action; replace prompt-based format instructions with tool schema; preserve confirmation flow via `submit_response` actions
- `changes-workflow`: Replace `<change-request>` and `<resume-request>` tag detection with `propose_change` tool + `find_sessions` query tool + `submit_response` actions; replace `<follow-up-command>` tags with `request_review`, `request_merge`, `request_update`, `request_close` tools; `propose_change` validates branch/repo and detects existing worktrees for reuse
- `session-management`: Session context stores structured tool call history (tool name, args, result) instead of text-only conversation traces; persists `submit_response` output (sections + actions) as the structured last answer; tracks continuation state (choices presented, user selections) for multi-step flows
- `error-reporting`: Tool validation loops provide structured error feedback to Claude before user sees anything; tool errors are recoverable (Claude retries) vs XML parse failures (silent fallback); conversation trace captures typed tool call records instead of text summaries

## Impact

- **`src/claude.ts`**: Major rewrite — remove `parseChangeRequest()`, `parseResumeRequest()`, `parseConfigUpdate()`, answer extraction logic, priority routing chain; add tool server builder; simplify `buildSystemPrompt()` variable computation; change `askClaude()` return type from discriminated union to structured `submit_response` output
- **`src/slack/blocks.ts`**: Rewrite `getResponseBlocks()` from static template to dynamic renderer of `submit_response` sections and actions; add new block builders for choice buttons, followup buttons
- **`src/slack/handlers/`**: Add handlers for new action types (`clack_choice`, `clack_followup`); update existing handlers to work with tool-based response data
- **`src/changes/workflow.ts`**: Follow-up command detection moves from XML tag parsing to tool calls; `handleFollowUp()` refactored to receive structured tool data instead of parsed tags
- **`src/sessions.ts`**: Update `SessionContext` to store structured tool call history, `submit_response` payloads instead of flat `lastAnswer`, continuation state for choice/followup flows, and serialized staged intents for button handler resolution
- **`src/instructionVariables.ts`**: Dramatically simplify — remove most variable definitions
- **`src/instructions.ts`**: Simplify interpolation logic
- **`data/default_configuration/*.md`**: Rewrite instruction files — remove XML format documentation, remove state dump placeholders, keep behavioral guidance
- **New `src/tools/` directory**: Tool definitions, schemas, handlers, context types
- **Dependencies**: `zod` (for tool input schemas) — may already be present via Agent SDK
