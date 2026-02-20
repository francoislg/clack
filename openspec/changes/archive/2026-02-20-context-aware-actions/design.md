## Context

Claude currently receives no information about how its responses will be delivered. It doesn't know if the response is ephemeral (reaction-triggered, only visible to the requester), a DM, or a public thread reply. It also doesn't know what button (if any) triggered the current invocation.

This forces two workarounds:
1. `ensureEphemeralActions()` — server-side enforcement that injects accept/reject/refine buttons into ephemeral responses, even if Claude intentionally omitted them
2. `postDmThreadReply()` — strips Claude's actions entirely and replaces them with hardcoded "Send to thread" / "Reject" buttons

Both bypass Claude's decision-making. The instructions tell Claude to always include accept/edit/refine/reject for Q&A answers, which produces nonsensical buttons in DM and mention contexts.

## Goals / Non-Goals

**Goals:**
- Claude receives delivery context (isEphemeral, triggerType, isDmFirst) and uses it to decide which actions to include
- Remove all server-side button enforcement and stripping
- Claude controls DM-first action buttons via a new `send_to_thread` action type
- Button handlers pass delivery context when re-invoking Claude

**Non-Goals:**
- Changing what happens when buttons are clicked (accept/reject/refine handler logic stays the same)
- Adding new delivery modes
- Changing the DM-first synthesis flow (the `send_to_thread` handler still triggers synthesis server-side)

## Decisions

### 1. Inject delivery context into the user prompt, not the system prompt

The system prompt is built from static instruction files. Delivery context varies per invocation, so it belongs in `buildPrompt()` alongside other per-request context (thread context, work mode hint, refinements).

Format: a `DELIVERY CONTEXT` block in the prompt, similar to the existing `WORK MODE` block.

**Alternative considered:** Adding to system prompt via variables — rejected because it would require `loadInstructions` to accept dynamic runtime state, mixing concerns.

### 2. Add delivery context to `AskClaudeOptions`

Extend `AskClaudeOptions` with:
```ts
isEphemeral?: boolean;
triggerType?: "directMessages" | "mentions" | "reactions";
isDmFirst?: boolean;
```

These are already available on `SessionInfo` (stored in state and on disk), so button handlers can pass them through `getHandlerClaudeOptions()` without any new plumbing.

### 3. Add `send_to_thread` as a new action type in `submit_response`

Schema: `{ type: "send_to_thread", label?: string }`

Handler: reuse the existing `clack_dm_send_to_thread` action handler. The `postDmThreadReply()` function stops stripping Claude's actions — it renders whatever Claude provided, including `send_to_thread` buttons.

**Alternative considered:** Having Claude emit a `followup` with a magic prompt — rejected because `send_to_thread` triggers server-side synthesis, not a simple re-query. A dedicated action type makes the contract explicit.

### 4. Remove `ensureEphemeralActions()` entirely

The instructions will tell Claude that ephemeral responses MUST include accept, reject, and refine. This replaces server-side enforcement with prompt-level guidance.

If Claude fails to include them, the response still renders — just without buttons. This is acceptable because:
- The prompt is explicit about the requirement
- The same trust model already applies to all other action types
- Server-side enforcement was a band-aid, not a safety net

### 5. Instructions update strategy

Update the "Submitting Your Response" section in `instructions.md` to describe delivery modes and required actions per mode:

| Context | Required Actions | Optional Actions |
|---------|-----------------|------------------|
| Ephemeral (reaction) | accept, reject, refine | edit, choice, followup, change, etc. |
| DM-first (reaction→DM) | send_to_thread, reject | refine (or user replies in thread) |
| DM (direct message) | none | choice, followup, refine |
| Mention (@bot) | none | choice, followup, refine |

## Risks / Trade-offs

**[Claude ignores delivery context and still adds wrong buttons]** → The instructions are explicit and the DELIVERY CONTEXT block makes it hard to miss. If it happens, it's a prompt quality issue, fixable without code changes.

**[DM-first flow becomes dependent on Claude emitting `send_to_thread`]** → If Claude omits it, the user can still reply in thread to refine, and the conversation isn't stuck. The synthesis step is a convenience, not a requirement.

**[Breaking change for existing DM-first button stripping]** → The `postDmThreadReply()` change removes the hardcoded buttons. If Claude's instructions are wrong, DM-first users temporarily lose the "Send to thread" button. Mitigated by deploying instructions update alongside code change.
