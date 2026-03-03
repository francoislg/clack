## Context

Currently, `buildDeliveryContext()` in `src/claude.ts` reads delivery state from `AskClaudeOptions` flags (`isDmFirst`, `isEphemeral`, `triggerType`). Every call site that invokes `askClaude` must reconstruct these flags manually. The initial flow in `core.ts` does this correctly, but secondary call sites (`processDmRefinement`, `synthesizeConversation`, button handlers) must independently reconstruct the same flags — and some don't.

The session already persists all the data needed to derive delivery context: `triggerType`, `isEphemeral`, `dmChannel`, `originChannel`, `channelPostTs`. This data is set once during session setup and doesn't change.

## Goals / Non-Goals

**Goals:**
- Derive delivery context from `SessionContext` fields so every `askClaude` call automatically gets correct context
- Make the delivery context prompt descriptive (describe the situation and list available actions) rather than prescriptive (mandate specific actions)
- Fix missing buttons on DM-first refinement responses
- Keep the `slackClient` option in `AskClaudeOptions` since it's a runtime dependency, not session state

**Non-Goals:**
- Changing the action types themselves or the block rendering logic
- Changing how `SessionInfo` (in-memory) works — only changing how delivery context reaches Claude
- Changing the synthesis flow's hardcoded Accept/Edit/Reject buttons (those are bot-controlled, not Claude-controlled)

## Decisions

### 1. Derive delivery context from session, not options

`buildDeliveryContext` will take `SessionContext` instead of `AskClaudeOptions`. The derivation logic:

```
session.dmChannel && session.originChannel  → DM-first mode
session.triggerType === "reactions" && session.isEphemeral  → Ephemeral mode
session.triggerType === "directMessages"  → DM mode
session.triggerType === "mentions"  → Mention mode
```

**Why not keep both?** The options-based approach is the source of the bug. If we keep both, we'd need to decide precedence and it's more confusing. The session is the single source of truth.

**What about the first call?** `processMessage` persists `triggerType` and `isEphemeral` during `setupSession` (core.ts:122-126), and DM coordinates are stored via `storeDmCoordinates` — all *before* `askClaude` is called. So the session has the right data by the time `buildDeliveryContext` runs.

### 2. Remove delivery flags from AskClaudeOptions

Remove `isDmFirst`, `isEphemeral`, and `triggerType` from `AskClaudeOptions`. They become dead fields since `buildDeliveryContext` no longer reads them.

Keep `slackClient`, `workMode`, `abortController` — these are runtime concerns that don't belong on the session.

### 3. Descriptive delivery context prompt

Instead of:
```
- Mode: DM-first (reaction triggered, answer delivered via direct message)
- Include `send_to_thread` and `reject` actions so they can share or dismiss.
```

Use:
```
- Mode: DM-first (reaction triggered, answer delivered via direct message)
- The user sees your response in a private DM thread. They can reply to refine.
- Available actions: `send_to_thread` (share to original channel), `reject` (dismiss)
- Choose actions appropriate to your response. Not every response needs the same buttons.
```

This gives Claude the vocabulary of available actions without mandating a fixed set. If the user asks for a code change, Claude can include `propose_change` instead of `send_to_thread`.

For DM-first mode, also include session state that affects behavior:
- Whether an answer has already been shared (`channelPostTs` present)
- This lets Claude adjust guidance (e.g., "an answer was already shared to the channel")

### 4. Simplify call sites

After this change, all secondary call sites (`processDmRefinement`, `synthesizeConversation`, button handlers) just pass the session to `askClaude` and get correct delivery context automatically. The `getHandlerClaudeOptions` function no longer needs to reconstruct `isDmFirst`.

## Risks / Trade-offs

**Claude might not always include the right buttons** → Mitigated by listing available actions explicitly. The current prescriptive approach already fails (this bug), so the descriptive approach is no worse in practice. We can tighten instructions later if Claude proves unreliable.

**Session must have delivery fields set before first askClaude call** → Already the case. `setupSession` persists `triggerType`/`isEphemeral`, and `storeDmCoordinates` sets DM fields, both before the first `askClaude` call in `processMessage`.

**`synthesizeConversation` doesn't need delivery context** → Its output is used as plain text with hardcoded buttons. We could skip delivery context for synthesis calls by passing a flag, but it's simpler and harmless to include it. Claude seeing "you're in a DM thread" doesn't hurt synthesis quality.
