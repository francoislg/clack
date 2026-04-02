## Context

Every `query()` call to the Claude Agent SDK is currently a fresh, isolated conversation. Follow-ups in threads reconstruct context by fetching Slack thread messages and injecting them into the prompt -- but Claude never sees its own tool calls, tool results, or reasoning from previous turns. The SDK already supports session resumption via `resume: sessionId`, and Clack is already persisting SDK sessions by default (the `persistSession` option defaults to `true`). There are 7 call sites (across 6 files) importing `query()` directly from the SDK, with no enforcement of persistence choices.

### Current call sites

| Call site | File | Persistence today | Should persist? |
|-----------|------|-------------------|-----------------|
| `askClaude()` | `src/claude/index.ts` | default (true) | Yes -- Q&A sessions |
| `runClaudeInWorktree()` | `src/changes/execution.ts` | explicit false | Yes -- change follow-ups |
| `summarizeForSlack()` | `src/claude/utilities.ts` | default (true) | No |
| `analyzeError()` | `src/claude/utilities.ts` | default (true) | No |
| `runPreAnalysis()` | `src/claude/preAnalysis.ts` | default (true) | No |
| `testMcpServer()` | `src/claude/testMcp.ts` | default (true) | No |
| migration engine | `src/migrations/engine.ts` | default (true) | No |

### SDK resume behavior (verified from source)

- `resume: sessionId` loads the full conversation history from `~/.claude/projects/{cwd-slug}/{sessionId}.jsonl`
- A new `systemPrompt` passed on resume **overrides** the original (no merging)
- `cwd` can change between turns (independent of resume)
- The SDK handles **automatic context compaction** when conversations approach context limits
- `session_id` is a UUID, emitted on the `init` message (`type: "system"`, `subtype: "init"`)
- Sessions are JSONL files containing every message, tool call, and tool result

## Goals / Non-Goals

**Goals:**
- Give Claude full conversation memory across turns in a thread (tool calls, results, reasoning)
- Enforce explicit persistence decisions at every SDK call site via wrapper functions
- Stop persisting throwaway utility sessions (currently ~5 of 7 call sites create junk)
- Enable cross-session debugging via an admin MCP tool
- Enable change execution resume so Claude remembers what it did in the worktree

**Non-Goals:**
- Cross-thread or cross-session memory (each thread is its own conversation)
- Changing session cleanup policy (existing age-based eviction stays)
- SDK session file cleanup (separate concern; the junk reduction helps, but a cleanup strategy for legitimate sessions is future work)
- Modifying how `threadContext` is fetched from Slack (still needed for messages from other users)

## Decisions

### Decision 1: Two wrapper functions, ban direct `query()` imports

Introduce `clackQuery()` and `clackSession()` in a new `src/claude/query.ts` module. All call sites import from this module instead of the SDK directly.

- **`clackQuery()`**: Sets `persistSession: false`. Fire-and-forget. Returns the same async iterable as `query()`.
- **`clackSession()`**: Sets `persistSession: true`. Captures `session_id` from the `init` message. Accepts an optional `resumeSessionId` to pass as `resume`. Returns the async iterable plus emits the captured `session_id` via a callback or return channel.

**Why not a single wrapper with a `persist` boolean?** The two functions communicate intent at the call site. `clackQuery` is self-documenting: "this is throwaway." `clackSession` signals: "this participates in a multi-turn conversation." A boolean parameter would be easy to get wrong and doesn't carry the same semantic weight.

**Alternative considered: TypeScript branded type / lint rule.** We could re-export `query` with `persistSession` required in the type. But this only catches missing fields, not wrong values, and doesn't give us a hook point for session ID capture.

### Decision 2: Store SDK session ID on SessionContext

Add `sdkSessionId?: string` to `SessionContext`. It is:
- Set after the first `clackSession()` call for a Clack session (captured from `init` message)
- Persisted to `context.json` (survives restarts)
- Passed as `resume` on subsequent queries in the same thread

**Why optional?** Existing sessions won't have it. First query in any new session won't have it either (it's captured during, not before, the first call). The wrappers handle `undefined` gracefully by starting a fresh session.

### Decision 3: Thread context becomes a delta

Today, `buildPrompt()` injects the full Slack thread context into every query. With resume, Claude already has the history of its own messages and the user messages it responded to. The thread context injection shifts to only include messages Claude hasn't seen -- messages posted to the thread by other users or by the bot (e.g., button confirmations) since the last query.

This requires tracking a "last seen thread timestamp" on the session. On each query, we fetch thread replies newer than that timestamp and inject only those as context.

**Prompt structure on resumed turns:** When resuming, `buildPrompt()` omits the full thread context (Claude already has it from the SDK session history) and injects only delta messages. The `originalQuestion` is always included because it is updated to the latest user message on each follow-up — it represents the current turn's content, not the initial question. The system prompt is always sent fresh (the SDK override mechanism handles this).

**Fallback:** If `sdkSessionId` is missing (first query or legacy session), the full prompt is built as today — including original question and full thread context.

### Decision 4: `executeChange` becomes a session

Change `runClaudeInWorktree()` to use `clackSession()` instead of `clackQuery()`. The `sdkSessionId` for change executions is stored on the change state (not the main session, since a thread can have both Q&A and change sessions).

The existing `resumeContext` parameter (which tells Claude to "check git status") becomes unnecessary for resumed sessions but is kept as fallback for the first call or when the SDK session is lost.

**Storage:** The SDK session ID for changes is stored alongside the change plan (e.g., in `ChangePlan` or `ActiveChangeState`). This is separate from the Q&A `sdkSessionId` on `SessionContext`.

### Decision 5: Session trace tool reads SDK JSONL files

The `get_session_trace` MCP tool reads the SDK session file directly from `~/.claude/projects/{slug}/{sdkSessionId}.jsonl`. It parses the JSONL and returns a structured summary: message types, tool calls with args, truncated results, timestamps.

**Gated to admin role.** Session traces may contain sensitive data (file contents, user messages).

**Two detail levels:**
- Default: message flow overview (types, tool names, timestamps) -- fits in a single response
- `verbose`: includes tool call args and truncated results -- for when you need to see exactly what Claude saw

### Decision 6: Graceful degradation when resume fails

If a `resume` call fails (session file deleted, corrupted, SDK error), the wrapper catches the error and falls back to a fresh `query()` call. The `sdkSessionId` on the session is cleared so the next query captures a new one.

This means resume is best-effort: if it works, great; if not, we degrade to today's behavior silently. No user-facing errors for lost SDK sessions.

## Risks / Trade-offs

**SDK session file growth** -- Long conversations with heavy tool use (many `Read` calls) create large JSONL files. The SDK's auto-compaction handles context window limits, but the files themselves grow unboundedly. Mitigation: this is no worse than today (sessions are already being saved). A future cleanup job can prune old SDK session files alongside Clack session cleanup.

**Two session systems** -- Clack sessions (our own, in `data/sessions/`) and SDK sessions (`~/.claude/projects/`) are now coupled but managed separately. If one is cleaned up without the other, resume silently degrades to fresh queries. Mitigation: graceful fallback (Decision 6) makes this a non-issue functionally; we can add coordinated cleanup later.

**System prompt drift on resume** -- We pass a fresh `systemPrompt` on each resume (which overrides the original), so this is handled correctly. But the prompt now appears twice in the conversation: once from the original session and once from the override. Token cost for the system prompt is paid on every turn regardless. Mitigation: the SDK likely handles this efficiently (the override replaces, not appends).

**`cwd` changes between turns** -- For Q&A, `cwd` is always the repos directory, so no issue. For changes, `cwd` is the worktree path, which is stable across follow-ups. No risk here.

**Thread context delta accuracy** -- If the "last seen timestamp" tracking is off, Claude might miss messages or see duplicates. Mitigation: timestamp is updated after each successful query; duplicates are benign (Claude can handle seeing a message twice); missing messages are caught by the thread context fallback.
