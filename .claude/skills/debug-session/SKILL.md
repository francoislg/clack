---
name: debug-session
description: Investigate a Slack session where Clack went wrong — given a Slack thread permalink and a description of the issue, read the persisted session, correlate it with the user's complaint, dig into the relevant source code, and produce a written root-cause assessment with suggested fixes. Use whenever the user pastes a Slack link alongside a complaint about Clack's behavior ("Claude did X in this thread and it was wrong", "this session got the answer wrong", "the bot picked the wrong repo here", "something broke in this thread"), even if they don't use the word "debug".
---

# Debug a Slack session

Investigate *why* Clack handled a specific Slack thread the way it did, and report back with concrete code-level suggestions. The user applies the fix themselves — do not edit source code as part of this skill. The goal is diagnosis, not repair.

## Inputs

The user provides:
1. A Slack thread permalink
2. A short description of the issue (what looked wrong, what they expected)

If either is missing, ask for it before proceeding.

## Workflow

### 1. Parse the Slack link

Slack permalinks look like `https://{workspace}.slack.com/archives/{CHANNEL_ID}/p{16DIGIT_TS}` and sometimes carry `?thread_ts={TS}&cid={CHANNEL}`.

- `CHANNEL_ID` is the segment after `/archives/`. It starts with `C`, `G`, or `D`.
- The `p`-prefixed number is a Slack message timestamp with the decimal point stripped. Insert a `.` six digits from the right: `p1775833779602979` → `1775833779.602979`.
- If `?thread_ts=X.Y` is present, `X.Y` is the **thread root** — that's what matches the `threadTs` field on sessions. The `p` number is the specific reply being linked. Use `thread_ts` for session lookup in this case.
- If `?thread_ts` is absent, the `p` number is itself the thread root (the link points at the top-level message).

So from the link, derive `channelId` and `threadTs`.

### 2. Locate the session

Two kinds of persisted sessions exist, and the right one depends on whether the thread triggered a Q&A or a Changes Workflow. Check both.

**Q&A sessions** (`data/sessions/`)

Directories are named `{channelId}-{tsSecs}-{tsMicros}-{userId}-{createdAtMs}`. The `threadTs` in a session equals `messageTs` when the session started the thread, so its directory prefix is `{channelId}-{tsSecs}-{tsMicros}` where `{tsSecs}.{tsMicros}` is the thread_ts with `.` replaced by `-`.

Find candidates by listing `data/sessions/` and filtering for names starting with `{channelId}-{threadTs with . → -}`. Multiple matches are possible (different users triggering in the same thread is rare but possible — pick by opening `context.json` and matching `threadTs` exactly).

Read the session's `context.json`. The fields that matter for debugging:
- `trigger` — structured metadata describing what started the session. A discriminated union keyed on `type`:
  - `{ type: "reactions", userId, emoji, messageTs, messageText, imageFiles? }` — someone reacted with a configured emoji.
  - `{ type: "mentions", userId, messageTs, messageText, imageFiles? }` — @Clack in a channel/thread.
  - `{ type: "directMessages", userId, messageTs, messageText, imageFiles? }` — DM to Clack.
  - `{ type: "autoRespond", userId, messageTs, messageText, ruleName?, imageFiles?, preAnalysis? }` — auto-respond rule matched; `preAnalysis` captures the session-creating verdict.
  - `{ type: "scheduled", jobId?, prompt, preAnalysis? }` — cron fired; `prompt` is the cron's instruction.
  - The trigger is independent from `messages[]` — it records what kicked off the session without being part of the turn log.
- `messages[]` — the unified temporal log of everything after the trigger. `messages[0]` is usually Clack's first assistant response (NOT the user's message — that's on `trigger`). Entries are either `{ role: "user", source, text, ts, value? }` (source: `"reply" | "choice" | "followup"`) or `{ role: "assistant", ts, text?, payload?, toolCalls?, error?, skipped?, disengaged?, postedTopLevel?, preAnalysis? }`.
  - User messages are replies/button clicks/followups that arrived after the trigger, in temporal order.
  - Assistant messages carry their own per-turn `toolCalls[]` and `payload`. `skipped: true` means Claude declined to reply; `error` means the turn failed; `postedTopLevel: true` means the response was posted to the channel, not the thread. `preAnalysis` on an assistant turn records the gate verdict for THAT specific turn (autoRespond thread replies run pre-analysis per turn).
  - The `find_session_transcript` tool returns the trigger AND paginated `messages[]` in one call — useful when reading `context.json` directly is noisy.
- `triggerType` — `reactions`, `directMessages`, `mentions`, `autoRespond`, `threadReply`, or `scheduled` (mirrors `trigger.type` for convenience; `threadReply` only appears on sessions reused via the auto-respond thread path).
- `errors[]` — `{ errorMessage, conversationTrace, timestamp }`. Present when something threw. (Per-turn failures are also captured on the corresponding `messages` entry as `message.error`.)
- `stagedIntents` — action-button intents Claude queued
- `channelName`, `userId`, `username`, `displayName`

> **Pre-migration note**: sessions written before the trigger split (and the earlier unified-conversation-log change) persist a flatter shape — either the legacy `originalQuestion` / `refinements[]` / `lastAnswer` / `lastResponse` / `toolCallHistory` fields, or an early `messages[]` where `messages[0]` had `source: "initial"`. Clack's `getSession` synthesizes `(trigger, messages[])` for those on read and writes the new shape back on next `updateSession`. If you open `context.json` directly and see legacy fields, or see a user entry at `messages[0]` with `source: "initial"`, that's expected — the information is the same, just laid out differently.

**Worker sessions** (`data/worktree-sessions/`)

Changes Workflow threads also produce a session here, keyed by branch name (slashes replaced with `-`), not by channel. To find the right one, scan `data/worktree-sessions/*/state.json` and match `channel` + `threadTs` against the link.

Each folder contains:
- `state.json` — `{ sessionId, status, phase, branch, repo, userId, description, prUrl, channel, threadTs, lastMessage, startedAt, lastActivityAt }`
- `execution.log` — timestamped log lines from the worker run. The worker **does not persist per-tool-call history** the way Q&A does — this log is your main source of truth for what happened inside the worktree.

A single thread can have both kinds of session (Q&A that led to a change request, then a worker session for the implementation). Read whichever is relevant to the issue, or both.

**SDK conversation log — ALWAYS READ THIS** (`data/.claude/projects/`)

Clack's `context.json` only stores the *latest turn's* tool calls and response — earlier turns get overwritten. The underlying Claude Agent SDK log captures every turn, every user message, every tool call, every tool result, in order, and is the source of truth for what actually happened.

**Read the JSONL every time, not just when you suspect multi-turn complexity.** Even single-turn sessions have detail in the JSONL (system prompt, full tool_result payloads, intermediate assistant text) that `context.json` drops. Locating the file is not enough — open it and scan it before forming any hypothesis. The only acceptable reason to skip this step is when the file genuinely doesn't exist on disk.

The SDK persists each session as `{sdkSessionId}.jsonl` under `data/.claude/projects/<project-subdir>/`. The project subdir varies depending on which repo Claude was operating in (e.g., `-app-data-repositories`, `-app-data-worktrees-applauz-monorepo-clack-fix-foo`), so glob across subdirs:

```
data/.claude/projects/*/{sdkSessionId}.jsonl
```

`sdkSessionId` is on the Clack session at `context.json` → `sdkSessionId`. If it's missing or the JSONL file isn't on disk (older sessions, or the SDK evicted it), say so explicitly in your assessment and fall back to what's in `context.json` — that's the only data available for those.

The JSONL is one JSON object per line. The line types you care about:
- `user` — user-role messages. The first one usually contains a long system-injected preamble ("DELIVERY CONTEXT: ...") followed by the actual user input. Subsequent `user` lines often carry `tool_result` blocks (results from the previous tool call).
- `assistant` (under a `message` wrapper) — Claude's text and `tool_use` blocks. Tool calls live here as `{ type: "tool_use", name, input, id }`.
- `system` (subtype `init`) — start of a turn, carries the `session_id`.
- `queue-operation`, `last-prompt`, `skill_listing`, `file-history-snapshot`, etc. — internal bookkeeping, generally skip.

To reconstruct a turn-by-turn view, walk the lines in order and group by the `init` boundaries (or just by the natural user → assistant → tool_result → assistant pattern).

If no Clack session is found at all, stop and tell the user — it likely means the session was evicted (30-day age cap for Q&A sessions) or the link points at a thread that never triggered Clack.

### 3. Reconstruct the story

From the session data, build a timeline. **The SDK JSONL is the primary source** — always work from it when the file exists, not from `context.json` snippets. Use the Clack `context.json` (`messages[]` + triggering metadata like channel, user, `triggerType`, `errors[]`) as the fallback when the JSONL isn't on disk and to understand the Slack-side framing around each turn.

- What did the user ask? Start with `trigger.messageText` (or `trigger.prompt` for scheduled), then walk `messages[]` in order for subsequent user replies/button clicks/followups.
- Which tools did Claude call on each turn, in what order, with what args, and what did they return (per-turn `toolCalls[]` on each assistant message, or the JSONL for the full picture)?
- Did any tool error or return a surprising result?
- What did Claude say back, turn by turn (each assistant `messages` entry carries `text`, `payload`, and flags like `skipped` / `postedTopLevel`)?
- Where does that diverge from what the user expected, per their description of the issue?

Name the divergence concretely. Typical shapes:
- **Wrong repo chosen** — Claude called `list_repositories` then picked one that didn't match the question.
- **Tool returned nothing useful** — e.g., `git_log` came back empty because history wasn't deep enough; Claude didn't call `deepen_history`.
- **Misread the question** — Claude's plan in its tool args shows a different interpretation than what the user asked.
- **Missing capability** — Claude had no tool for what was needed and made something up, or stalled.
- **Prompt steered it wrong** — the system prompt or an instruction file nudged Claude away from the right path.
- **Permission/role gate** — the tool Claude needed was hidden at the user's role tier.
- **Worker-mode failure** — `execution.log` shows the branch/PR steps that failed.

### 4. Investigate the code

Once you have a candidate root cause, read the relevant source to confirm it and locate the fix site. The map:

- **A specific tool misbehaved** → `src/tools/query/{tool}.ts`, `src/tools/actions/{tool}.ts`, `src/tools/worker/{tool}.ts`, or `src/tools/presentation/submitResponse.ts`. Also check `src/tools/server.ts` for role gating and availability rules.
- **Claude was fed bad context** → `src/tools/context.ts` (tool context builders), `src/sessions.ts` (what's persisted and surfaced).
- **System prompt steered Claude wrong** → `src/claude/promptBuilder.ts` assembles the prompt. The shipped instruction defaults live under `data/default_configuration/`, with user overrides in `data/configuration/` taking precedence. Per-repo instructions live at `data/configuration/{repo}/` or `data/default_configuration/{repo}/`.
- **Query orchestration / delivery issue** → `src/slack/handlers/core.ts` (`processMessage`).
- **Changes Workflow issue** → `src/changes/execution.ts` (`executeChange`), `src/changes/workflow.ts`, `src/changes/askClaudeWorktree.ts`, `src/changes/pr.ts`, `src/changes/monitor.ts`.
- **Role / permission issue** → `src/roles.ts`, `src/permissions.ts`, `src/repoAccess.ts`.

Use the LSP tool (goToDefinition, findReferences, hover) before falling back to Grep/Glob — this is a TypeScript project and navigation is much more reliable that way.

When citing code, use `file:line` so the user can jump to the location.

### 5. Write the assessment

Deliver the investigation as a single message to the user with these sections:

**What the user asked**
One or two sentences summarizing the request, quoting the key line(s) from `trigger.messageText` / `trigger.prompt` and user replies in `messages[]` verbatim where helpful.

**What Clack did**
A short narrative or bullet list of the tool calls and responses, in order, with the specific args/results that matter. Don't dump the whole history — pick the 3–6 steps that explain the outcome.

**Where it went wrong**
Name the divergence. Tie it to the user's complaint.

**Root cause**
Point at the code. Use `file:line` references. Explain *why* the code produces this behavior — not just what line is responsible. If the root cause is a prompt/instruction rather than code, say so and cite the file.

**Suggested fixes**
One or more concrete suggestions the user can act on. Each should be specific enough to implement: which file, roughly what change, and why it would address the root cause. If there are tradeoffs between fixes, flag them. If more than one change is needed, list them.

**Not applied**
End with an explicit one-liner: *"I haven't applied any of these — decide which (if any) you want and I'll implement it when you ask."* This matters because the skill's contract is diagnosis-only; stating it avoids confusion.

## Notes

- Sessions with `errors[]` populated are preserved past the 30-day cleanup window, so old failure cases are often still investigable.
- The SDK JSONL is still the richest per-turn source (full system preamble, every tool_use + tool_result). Always read it (step 2) alongside `messages[]`. `messages[]` is authoritative for what the user sent / what Claude returned; the JSONL is authoritative for *how* Claude reached that outcome.
- The `find_session_transcript` tool (query-mode) returns paginated `messages[]` for a given `sessionId` with full per-turn payload and `toolCalls[]`. Useful when you want a structured view without parsing raw JSON. Subject to the standard privacy rules (owner always, non-owner only for public channels).
- Tool results in both the JSONL and `messages[].toolCalls[]` are stored as whatever the tool returned — they may be large (e.g., `view_slack_image` embeds base64). Skim first, then zoom in on the ones that look decisive.
- If you find the Clack session was never persisted (no match on disk), that itself might be the bug — surface it and check `src/sessions.ts` and the handler that would have created it.
- If the user's complaint is about *delivery* (wrong channel, missing thread, etc.) rather than Claude's reasoning, focus on `src/slack/handlers/core.ts`, `src/slack/dmResponse.ts`, and `src/slack/messagesApi.ts` rather than the tool history.
- The bot sets `CLAUDE_CONFIG_DIR=/app/data/.claude` in its Dockerfile, which is why SDK JSONLs land under `data/.claude/projects/` and travel with the rest of `data/`. If you ever debug a setup where that env var isn't set, the JSONLs will be under `~/.claude/projects/` instead.
