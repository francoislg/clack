## Context

The `:clack-work:` emoji currently uses a separate code path (`handleChangeReaction`) that:
1. Calls `generateChangePlan()` — a raw Claude call with XML system prompt and no tools
2. Regex-parses `<change-plan>` XML from the response
3. Goes directly to `startChangeWorkflow()` with no user confirmation

This path is broken because the Agent SDK's result event overwrites the accumulated streaming text (which contained the XML tags). Meanwhile, the `:clack:` flow already supports change proposals via `propose_change` tool + `auto: true` for auto-execution.

The goal is to route `:clack-work:` through the same `processMessage()` pipeline as `:clack:`, with a signal that biases Claude toward proposing and auto-executing a change.

## Goals / Non-Goals

**Goals:**
- Unify `:clack-work:` into the `processMessage` flow so it benefits from MCP tools, instructions, and structured responses
- Provide a `workMode` signal so Claude knows this is an explicit work request (propose + auto-execute)
- Gracefully fall back to standard Q&A for non-dev users (no error, just treat as `:clack:`)
- Remove dead legacy code (`handleChangeReaction`, `generateChangePlan`, XML parsing)

**Non-Goals:**
- Changing how the execution phase works (worktrees, `startChangeWorkflow`, etc.)
- Changing the `propose_change` tool or its validation logic
- Modifying instruction files content (the `workMode` hint goes in the prompt, not instructions)

## Decisions

### 1. Work mode as a `processMessage` parameter, threaded to `askClaude`

Add `workMode?: boolean` to `ProcessMessageParams` and `AskClaudeOptions`. When set, `askClaude` prepends a work-mode hint to the user prompt.

**Why a prompt hint rather than a separate system prompt**: The existing instruction system (role-based, per-trigger) should remain the authority on Claude's behavior. The work-mode hint is a contextual nudge ("the user explicitly wants you to do this work"), not a new persona. Putting it in the user prompt keeps it lightweight and avoids forking the instruction pipeline.

**Prompt hint content** (appended before the QUESTION):
```
WORK MODE: The user explicitly requested this as a work task (not a question).
Propose a code change using propose_change and set auto: true on the change action.
If you cannot determine what change to make, ask for clarification via submit_response.
```

### 2. Role fallback in the reaction handler, not in processMessage

The reaction handler in `newQuery.ts` checks the role. If the user is dev+, it calls `processMessage({ workMode: true })`. If not, it calls `processMessage()` without `workMode` — standard Q&A flow, no error message.

**Why here**: `processMessage` shouldn't know about emoji-specific role gating. The reaction handler already distinguishes trigger types, so this is the natural place for the gate. Non-devs simply get the standard flow — from their perspective, the emoji "works" (they get an answer), they just don't get the auto-execute behavior.

### 3. Remove dead code entirely

After the change, `handleChangeReaction`, `generateChangePlan`, `PLAN_GENERATION_PROMPT`, and the XML parsing logic are fully dead. Remove them to avoid confusion.

## Risks / Trade-offs

- **Claude might not always auto-execute**: Even with the hint, Claude may choose to ask a clarifying question instead of auto-executing. This is actually desirable — if the message is too vague, confirmation is better than a wrong change. → No mitigation needed, this is a feature.
- **Non-devs lose the "changes require dev" feedback**: Currently non-devs get an explicit ephemeral message. With the fallback, they just get a Q&A answer. → Acceptable: the Q&A answer is still useful, and the lack of a "you can't do this" message avoids confusion for users who don't know about the work emoji.
