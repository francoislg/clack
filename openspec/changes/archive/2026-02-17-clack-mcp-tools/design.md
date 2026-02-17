## Context

Claude currently communicates structured intent (change requests, config updates, resume requests) via XML-like tags embedded in text output. The bot parses these with regex, routes through a priority chain, and builds a fixed 5-button Slack UI for every response. Dynamic state (repos, sessions, config files) is pre-computed and injected into the system prompt via variable interpolation.

The Agent SDK (`@anthropic-ai/claude-agent-sdk` v0.2.7) already supports in-process MCP servers via `createSdkMcpServer()` and `tool()`, which accept Zod schemas and return `McpSdkServerConfigWithInstance` — passable directly in the `mcpServers` query option alongside external servers.

## Goals / Non-Goals

**Goals:**
- Replace XML tag formats and regex parsers with typed MCP tool calls
- Enable Claude to validate actions (change requests, config updates) with retry loops before presenting to the user
- Enable Claude to query system state dynamically (repos, sessions, config files) instead of receiving it in the prompt
- Enable Claude to control which Slack buttons appear and how they're labeled per response
- Add choice/followup continuation actions for multi-step conversational flows
- Simplify the instruction system by removing format documentation and state dumps from prompts
- Gate features by tool availability (role → tool set) rather than prompt content inclusion

**Non-Goals:**
- Changing the external MCP server system (GitHub, Sentry) — those remain as-is
- Modifying the autonomous Claude execution engine (how Claude runs inside a worktree) — that stays as-is
- Modifying PR creation itself (autonomous Claude handles that) — only the initiation and follow-up layers change
- Changing the session cleanup logic or timeout behavior
- Adding new user-facing features beyond what the tool system enables — this is infrastructure
- Modifying the Slack action handlers for accept/reject/edit — those remain functionally identical

## Decisions

### D1: In-process MCP server built per-query via closures

**Decision**: Build a fresh `clack` MCP server for each `askClaude()` call using `createSdkMcpServer()`, closing over the query's context (user, session, role, config, repos).

**Why**: Tool handlers need access to user identity, permissions, available repos, active sessions, and config state. Building per-query means each handler captures exactly the right context via closure — no global state, no context-passing through tool parameters, no risk of cross-query contamination.

**Alternatives considered**:
- *Singleton MCP server with context parameter on each tool call*: Would require Claude to pass user/session info in every tool call — wasteful tokens, error-prone, and leaks internal state into the conversation.
- *Separate MCP server process*: Adds deployment complexity (another process to manage, IPC overhead) for no benefit since we're in the same Node.js process.

### D2: Three-layer tool architecture (query → action → presentation)

**Decision**: Organize tools into three layers with distinct responsibilities:

1. **Query tools** — Read-only state lookups. No side effects. Always available to all roles.
2. **Action tools** — Validate and stage intent. Return a ref ID. Role-gated. Can fail (Claude retries).
3. **Presentation tool** — `submit_response` — defines what the user sees. Always the final tool called. Always available.

**Why**: Clean separation between discovering state, preparing actions, and presenting results. The ref pattern decouples validation from presentation — `submit_response` references a pre-validated intent rather than re-specifying it.

**Alternatives considered**:
- *Single mega-tool that does everything*: Loses the validation/retry benefit. Claude can't recover from errors if the action and presentation are one atomic call.
- *Action tools that directly trigger side effects*: Would bypass the Accept/Reject approval flow. Users must see and approve before actions execute.

### D3: Staged intent with ref IDs

**Decision**: Action tools (`propose_change`, `propose_config_update`) validate input and store intent in a per-query `Map<string, StagedIntent>`. They return a ref ID. `submit_response` references this ID in its actions array. The bot resolves refs after the query completes to wire up button handlers.

**Why**: Keeps `submit_response` clean (just refs, not full payloads). Ensures all data in actions was pre-validated. The Map lives in the closure — naturally scoped to the query lifecycle, no cleanup needed.

**Alternatives considered**:
- *submit_response carries full action data inline*: Duplicates data already validated by action tools. If Claude modifies values between the action call and submit_response, validation is invalidated.
- *Global intent store with TTL*: Unnecessary complexity. The closure already scopes the lifetime correctly.

### D4: `submit_response` as the single presentation surface

**Decision**: All user-facing output goes through `submit_response`. Claude's raw text output is ignored (or used only as fallback). The tool carries structured sections and a typed actions array.

**Why**: Makes Claude explicitly responsible for the UX. The bot becomes a renderer, not an interpreter. Every response gets exactly the buttons Claude declares — no more static 5-button template.

**Fallback**: If Claude fails to call `submit_response` (crashes, times out, or forgets), the bot falls back to showing Claude's raw text output with a generic error/retry UI. This preserves the graceful degradation property of the current system.

### D5: Typed action set (not freeform)

**Decision**: Actions in `submit_response` use a fixed set of types: `accept`, `reject`, `edit`, `refine`, `followup`, `choice`, `change`, `config_update`. Each type has a known schema. Claude picks which types to include and customizes labels/hints.

**Why**: The bot must know how to handle each action type (which Slack handler, which UI pattern). A freeform action system would require Claude to also define handler behavior, which is brittle and unpredictable.

The sweet spot: Claude controls *which* actions appear and *how they're labeled*, the bot controls *what each action does*.

### D6: Continuation actions (choice, followup, refine) resume the conversation

**Decision**: `choice`, `followup`, and `refine` actions inject user input back into the conversation and re-invoke Claude. The bot stores the query's session state (SDK session) to enable continuation.

`choice` actions carry a `value` field that gets injected as "The user chose: {value}".
`followup` actions carry a `prompt` field that gets injected as a new question.
`refine` opens a modal (existing behavior) and injects the user's text.

**Why**: Enables multi-step conversational flows (which repo? new or existing branch?) without hardcoding wizard logic in the bot. Claude decides when to ask and what to ask.

### D7: Follow-up commands become tools

**Decision**: The `<follow-up-command>` XML tags used in change threads (review, merge, update, close) become action tools: `request_review`, `request_merge`, `request_update`, `request_close`. These are available in change thread contexts where an active session with a PR exists.

**Why**: Same benefits as the Q&A tool migration — typed parameters, validation (e.g., "PR has merge conflicts, cannot merge"), retry loops, and Claude can explain failures to the user. Currently follow-up detection uses yet another XML tag format with its own parser.

The worktree lifecycle itself (creation, setup, cleanup) stays bot-managed — it's infrastructure that happens before/after Claude runs. But the **initiation** (propose_change validates branch/repo, checks for existing worktrees, offers reuse) and **follow-up operations** (merge, review, close, update) all become tools that Claude calls instead of XML tags.

**What stays bot-side**: `createWorktree()`, `removeWorktree()`, `runWorktreeSetup()`, worktree cleanup on merge/close, the monitor that detects external PR completion. These are triggered by action handlers after user approval, not by Claude directly.

### D8: Role-based tool gating

**Decision**: The per-query tool builder includes tools based on the user's role and context:

| Role | Query tools | Action tools | Presentation |
|------|-------------|-------------|-------------|
| member | `list_repositories` | — | `submit_response` |
| dev | all query tools | `propose_change` | `submit_response` |
| dev (in change thread) | all query tools | `propose_change`, `request_review`, `request_merge`, `request_update`, `request_close` | `submit_response` |
| admin/owner | all query tools | `propose_change`, `propose_config_update` | `submit_response` |

**Why**: If a tool isn't registered, Claude literally cannot call it. This is stronger than prompt-based gating ("don't use this tag") which relies on Claude following instructions. The change thread tools are context-gated — they only appear when there's an active change session in the current thread.

### D9: Session persistence captures tool interactions

**Decision**: Update session context to store structured tool call data instead of text-only conversation traces:

- **Tool call log**: Array of `{ tool, args, result, timestamp }` entries — every clack tool call recorded
- **Structured last response**: The `submit_response` payload (sections + actions) replaces the flat `lastAnswer` string
- **Continuation history**: Sequence of `{ presented: Action[], userChoice: string, timestamp }` entries for choice/followup/refine flows
- **Staged intents**: Serialized into session so button handlers can resolve refs even if the original query closure is gone (e.g., bot restart between Claude responding and user clicking a button)

**Why**: The current `conversationTrace` captures text summaries of SDK messages — useful but lossy. With tools, the interesting data is typed: what tool was called, with what arguments, what came back. This is better for debugging (see exact validation errors Claude hit), error reporting (show admins what went wrong), and session reconstruction (rebuild context for refinements and continuations).

The `lastAnswer` field currently stores raw markdown text. With `submit_response`, the structured payload (sections, actions, refs) is more useful — the bot can re-render it, and continuations know what was previously shown.

### D10: Instruction files stay role-separated, content shrinks

**Decision**: Keep `instructions.md`, `user_instructions.md`, `dev_instructions.md`, `admin_instructions.md` as separate files (preserving role-specific tone). Remove all XML format documentation and state dump variables. Retain `{BOT_NAME}` as the only interpolated variable.

**Why**: Different roles benefit from different tones (member gets friendly non-technical, dev gets more direct, admin gets config-aware). But the format documentation (how to use XML tags) and state dumps (repo lists, session lists) are no longer needed — tools handle that.

## Risks / Trade-offs

**Tool call overhead** → Claude makes extra API round-trips for tool calls vs. emitting text. Mitigation: Query tools are optional (Claude only calls them when needed), and the reduced prompt size (no state dumps) partially offsets the token cost.

**Claude forgets to call `submit_response`** → User sees no structured response. Mitigation: Fallback to raw text output with generic UI (same as current behavior when Claude forgets `<answer>` tags). The system prompt emphasizes that `submit_response` is required.

**Claude over-uses `choice` actions** → Multi-step flows feel like filling out a form. Mitigation: System prompt guidance ("use choice only when you genuinely cannot proceed; prefer reasonable defaults"). Can also add a `maxTurns` limit to the continuation loop.

**Breaking change for custom instruction files** → Users who customized instruction files with `{CHANGE_REQUEST_BLOCK}` etc. will have broken placeholders. Mitigation: Variables that no longer exist resolve to empty string (existing behavior). Log warnings for unknown variables. Document migration in release notes.

**Zod dependency** → `createSdkMcpServer` requires Zod for input schemas. Mitigation: Zod is already bundled in the Agent SDK — no new dependency.

**Staged intent Map memory** → The Map lives for the duration of a query. Mitigation: Queries are short-lived (seconds to low minutes). The Map contains at most 1-2 entries. No risk of memory growth.

## Open Questions

- **Should `list_repositories` be available to member-role users?** Members can't create changes, but knowing which repos exist might help Claude answer questions. Leaning yes — it's read-only and harmless.
- **SDK session persistence for continuations**: When a user clicks a `choice` button minutes later, does Claude need the full prior conversation context? Currently refinements rebuild context from session state. The same approach should work for choice continuations — inject the choice value into a fresh query with full session history.
- **`propose_change` and existing worktrees**: When `propose_change` validates a branch/repo, should it check for an existing worktree and return that info to Claude? This would let Claude tell the user "there's already a worktree for this branch — resume or start fresh?" via a `choice` action. Leaning yes — it's a natural fit for the query→choice pattern.
