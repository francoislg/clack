## 1. Foundation: Types and Tool Infrastructure

- [x] 1.1 Create `src/tools/` directory structure: `types.ts`, `context.ts`, `server.ts`, `query/`, `actions/`, `presentation/`
- [x] 1.2 Define core types in `src/tools/types.ts`: `ToolContext`, `StagedIntent`, `SubmitResponsePayload` (sections + actions), `ActionType` union, and per-action schemas (`AcceptAction`, `RejectAction`, `EditAction`, `RefineAction`, `FollowupAction`, `ChoiceAction`, `ChangeAction`, `ConfigUpdateAction`, `ReviewAction`, `MergeAction`, `UpdateAction`, `CloseAction`)
- [x] 1.3 Define `ToolContext` builder in `src/tools/context.ts`: takes user, role, session, config, repos, active change session → returns typed context
- [x] 1.4 Implement staged intent store in `src/tools/server.ts`: `Map<string, StagedIntent>` with `stage()` and `resolve()` helpers, ref ID generation

## 2. Query Tools

- [x] 2.1 Implement `list_repositories` tool in `src/tools/query/listRepositories.ts`: reads from config, returns `{ name, description, supportsChanges }[]`
- [x] 2.2 Implement `find_sessions` tool in `src/tools/query/findSessions.ts`: queries change sessions with optional filters (status, repo, branch), includes worktree existence info
- [x] 2.3 Implement `find_changes` tool in `src/tools/query/findChanges.ts`: queries active changes with optional filters, returns branch, repo, description, phase, PR URL
- [x] 2.4 Implement `list_config_files` tool in `src/tools/query/listConfigFiles.ts`: calls `listInstructionFiles()`, returns `{ filename, status }[]`

## 3. Action Tools

- [x] 3.1 Implement `propose_change` tool in `src/tools/actions/proposeChange.ts`: Zod schema for `{ branch, description, repo }`, validates branch convention (`clack/{type}/{name}`), validates repo exists and supports changes, checks for existing worktree, stages intent, returns ref + worktree info
- [x] 3.2 Implement `propose_config_update` tool in `src/tools/actions/proposeConfigUpdate.ts`: Zod schema for `{ file, content }`, validates filename against `listInstructionFiles()`, stages intent, returns ref
- [x] 3.3 Implement `request_review` tool in `src/tools/actions/requestReview.ts`: validates active session has PR URL, stages review intent
- [x] 3.4 Implement `request_merge` tool in `src/tools/actions/requestMerge.ts`: validates PR exists and is open, stages merge intent
- [x] 3.5 Implement `request_update` tool in `src/tools/actions/requestUpdate.ts`: Zod schema for `{ instructions }`, validates worktree exists, stages update intent
- [x] 3.6 Implement `request_close` tool in `src/tools/actions/requestClose.ts`: validates PR exists and is open, stages close intent

## 4. Presentation Tool

- [x] 4.1 Implement `submit_response` tool in `src/tools/presentation/submitResponse.ts`: Zod schema for `{ sections: { title?, body }[], actions: Action[] }`, validates action refs exist in staged intents, captures payload via closure
- [x] 4.2 Implement response capture mechanism: closure variable written by `submit_response` handler, `getResult()` accessor for `askClaude()` to read after query completes

## 5. Tool Server Builder

- [x] 5.1 Implement `buildClackTools()` in `src/tools/server.ts`: takes `ToolContext`, builds tool array based on role and context (member/dev/dev-in-change-thread/admin), calls `createSdkMcpServer()`, returns `{ mcpServer, getResult, getStagedIntents }`
- [x] 5.2 Wire tool server into `askClaude()` in `src/claude.ts`: call `buildClackTools()` with context, merge returned server into `mcpServers` option, read `getResult()` after query completes
- [x] 5.3 Add `allowedTools` for clack tools: ensure clack MCP tool names are not blocked by the existing `disallowedTools` list

## 6. Response Handling Rewrite

- [x] 6.1 Define new `ClaudeResponse` type: replace discriminated union (`isChangeRequest`, `isResumeRequest`, `isConfigUpdate`) with `{ success, response: SubmitResponsePayload | null, rawText: string, conversationTrace, error? }`
- [x] 6.2 Rewrite `askClaude()` response handling: remove `parseChangeRequest()`, `parseResumeRequest()`, `parseConfigUpdate()`, `<answer>` tag extraction, and priority routing chain; replace with reading `getResult()` from tool server; implement fallback to raw text
- [x] 6.3 Remove parser functions: delete `parseChangeRequest()`, `parseResumeRequest()`, `parseConfigUpdate()` from `src/claude.ts`
- [x] 6.4 Remove old interfaces: delete `ChangeRequestInfo`, `ResumeRequestInfo`, `ConfigUpdateInfo` from `src/claude.ts` (moved to tool types)

## 7. Slack Block Rendering

- [x] 7.1 Rewrite `getResponseBlocks()` in `src/slack/blocks.ts`: accept `SubmitResponsePayload` + sessionId, render sections as mrkdwn blocks with optional bold titles, render actions as typed buttons
- [x] 7.2 Implement action-to-button mapper: map each action type to Slack button (style, label, action_id, value encoding with session ID + action metadata)
- [x] 7.3 Add choice button rendering: render choice actions with labels and optional description subtitles
- [x] 7.4 Add followup button rendering: render followup actions with custom labels
- [x] 7.5 Update `getAcceptedBlocks()` to accept structured sections (for Accept handler posting publicly)

## 8. Slack Action Handlers

- [x] 8.1 Add `clack_choice` handler in `src/slack/handlers/choice.ts`: on click, inject "The user chose: {value}" into session, re-invoke `askClaude()`, post new ephemeral response
- [x] 8.2 Add `clack_followup` handler in `src/slack/handlers/followup.ts`: on click, inject followup prompt into session, re-invoke `askClaude()`, post new ephemeral response
- [x] 8.3 Update refine handler: support `hint` field from action metadata as modal placeholder text
- [x] 8.4 Add `clack_change` handler: on click, resolve staged intent ref from session, trigger change workflow with validated branch/description/repo
- [x] 8.5 Add `clack_config_update` handler: on click, resolve staged intent ref, validate admin, write file, confirm
- [x] 8.6 Add `clack_review`, `clack_merge`, `clack_update`, `clack_close` handlers: on click, resolve staged intent, trigger corresponding workflow function
- [x] 8.7 Register all new handlers in the Slack app setup

## 9. Core Handler Updates

- [x] 9.1 Update `handleSpecialResponses()` in `src/slack/handlers/core.ts`: remove `isChangeRequest`/`isResumeRequest`/`isConfigUpdate` branching; response rendering now always goes through the `submit_response` payload → block renderer path
- [x] 9.2 Update `processMessage()`: simplify response flow — `askClaude()` returns structured response, render via new block builder, post ephemeral
- [x] 9.3 Update change thread follow-up handling in `src/slack/handlers/core.ts` and `src/changes/workflow.ts`: remove `<follow-up-command>` tag parsing, follow-ups now come through tool calls + `submit_response` actions

## 10. Session Persistence

- [x] 10.1 Add `toolCallHistory` field to `SessionContext`: array of `{ tool, args, result, timestamp }`
- [x] 10.2 Replace `lastAnswer: string` with `lastResponse: SubmitResponsePayload` in session context
- [x] 10.3 Add `stagedIntents` field to session: serialized Map of intent refs → validated data, persisted to `context.json`
- [x] 10.4 Add `continuationHistory` field to session: array of `{ actionType, userInput, timestamp }`
- [x] 10.5 Update `askClaude()` to write tool call history and structured response to session after query
- [x] 10.6 Update session reconstruction for expired sessions: handle both new `lastResponse` format and legacy `lastAnswer` for backward compat during rollout

## 11. Instruction System Simplification

- [x] 11.1 Simplify `buildSystemPrompt()` in `src/claude.ts`: remove computation of `REPOSITORIES_LIST`, `MCP_INTEGRATIONS`, `CHANGE_REQUEST_BLOCK`, `RESUMABLE_SESSIONS`, `CONFIG_UPDATE_BLOCK`, `AVAILABLE_VARIABLES`; keep only `BOT_NAME`
- [x] 11.2 Update `src/instructionVariables.ts`: remove all entries except `BOT_NAME` from the registry; remove `buildAvailableVariablesTable()` function
- [x] 11.3 Rewrite `data/default_configuration/instructions.md`: remove XML format documentation, remove `{REPOSITORIES_LIST}` and `{MCP_INTEGRATIONS}` placeholders, keep behavioral guidance and tone instructions; add brief guidance on using clack tools
- [x] 11.4 Rewrite `data/default_configuration/dev_instructions.md`: remove `{CHANGE_REQUEST_BLOCK}` and `{RESUMABLE_SESSIONS}` placeholders, keep role-specific tone
- [x] 11.5 Rewrite `data/default_configuration/admin_instructions.md`: remove `{CONFIG_UPDATE_BLOCK}` and `{AVAILABLE_VARIABLES}` placeholders, keep role-specific tone
- [x] 11.6 Update `data/default_configuration/user_instructions.md`: remove any state dump placeholders, keep role-specific tone

## 12. Error Reporting Updates

- [x] 12.1 Update `ConversationMessage` type to include optional `toolCall` field: `{ tool, args, result }` for typed tool call records
- [x] 12.2 Update conversation trace capture in `askClaude()`: record clack tool calls with full detail (name, args, result) instead of text summaries
- [x] 12.3 Update `analyzeError()`: pass typed tool call records to Claude for richer error analysis
- [x] 12.4 Update DM error report formatting: include tool call history in the summarized trace

## 13. Cleanup and Integration Testing

- [x] 13.1 Remove `AskClaudeOptions` fields that are no longer needed: `availableRepos`, `resumableSessions` (these are now tool-queryable)
- [x] 13.2 Remove unused imports: `getConfiguredMcpServerNames`, `buildAvailableVariablesTable`, `canEditConfig` from `src/claude.ts` (permission check moves to tool gating)
- [x] 13.3 Verify tool server startup with `testMcpServers()`: ensure clack tools appear alongside external MCP tools in the test output
- [ ] 13.4 End-to-end test: Q&A flow — Claude uses `submit_response` with accept/reject, bot renders correctly
- [ ] 13.5 End-to-end test: change request flow — Claude calls `propose_change` → `submit_response` with change action → user approves → workflow starts
- [ ] 13.6 End-to-end test: choice continuation — Claude presents choices → user clicks → Claude resumes
- [ ] 13.7 End-to-end test: config update flow — admin asks to update config → Claude calls `propose_config_update` → `submit_response` → admin approves
- [ ] 13.8 End-to-end test: change thread follow-ups — user says "merge it" → Claude calls `request_merge` → `submit_response` → user approves → PR merged
