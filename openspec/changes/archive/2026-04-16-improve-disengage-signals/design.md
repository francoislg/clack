## Context

Disengagement today is gated through two paths:

1. **Pre-analysis** — classifier returns `"stop"` and `autoResponseActive` flips to `false` before Claude runs.
2. **`submit_response` skip path** — Claude calls the tool with both `skip_response: true` and `disengage: true`. Guarded by an explicit check that rejects `disengage` without `skip_response` (`src/tools/presentation/submitResponse.ts:310-318`).

Direct `@Clack` mentions bypass pre-analysis (`src/slack/handlers/mention.ts:52-65`) and actively re-activate disengaged threads. That means the only way a mention like "thanks Clack" can end the conversation is if Claude chooses to skip + disengage — which it won't reliably do, because the current tool description doesn't name dismissals as a trigger, and "reply + disengage" isn't even allowed.

## Goals / Non-Goals

**Goals:**
- Make `disengage: true` a legal flag on both skip and normal response paths.
- Give Claude explicit guidance (via schema descriptions and prompt) that user dismissals are a canonical disengage trigger.
- Keep existing skip+disengage behavior intact for backward compatibility.

**Non-Goals:**
- Touching the pre-analysis classifier — it already handles "stop" well for thread replies.
- Adding a separate phrase-matcher or heuristic for mentions. Detection stays with Claude (via the tool description).
- Changing `stop_tracking` or cross-thread disengagement.

## Decisions

### Decision 1: Allow `disengage: true` on normal responses

Remove the guard at `submitResponse.ts:310-318`. After the normal delivery path succeeds, if `disengage === true`, mark the capture as disengaged so the handler can flip `autoResponseActive = false`.

**Alternatives considered:**
- *Separate `end_conversation` tool.* Rejected — adds surface area for the same signal and splits logic across two tools.
- *Auto-disengage based on response content heuristics.* Rejected — fragile and opaque.

### Decision 2: Propagate disengage via `ResponseCapture`

`ResponseCapture` already carries a disengaged flag on the skip path (`setSkipped(disengaged)`). Extend it to also accept a `disengaged` flag on the normal success path — e.g., a new `responseCapture.setDisengaged()` or an optional second argument to `responseCapture.set()`. The handler (`src/slack/handlers/handlerResponse.ts`) then reads `capture.disengaged` on the success path, the same way it already does for the skip path at lines 396-398.

**Alternative considered:** Returning `disengaged` in the tool result and having the handler parse the tool-call history. Rejected — `ResponseCapture` is already the single source of truth for response state.

### Decision 3: Schema description is the behavioral signal to Claude

Claude's only durable interface is the Zod `.describe()` text. Update the `disengage` description to:

- Name dismissal phrases ("thanks Clack", "you're done", "that's all") as canonical triggers.
- State explicitly: "may be combined with a normal response — reply and disengage in the same turn."
- Keep the existing "conversation moved on" guidance.

Also update the `src/claude/promptBuilder.ts` / delivery-context prompt guidance (covered by the existing "Prompt Guidance for Disengagement" requirement) so it reflects the expanded behavior.

### Decision 4: Availability of `disengage` flag

Currently `disengage` is only in the schema when `allowSkip` is true (trigger is `autoRespond` or `threadReply`). Mention-triggered sessions should also expose it — a user dismissing Clack via `@mention` ("thanks, we're done") is exactly the case this change targets. Gate the flag on whether the trigger type is one that can be re-activated (which is all of them, effectively), not on `allowSkip`.

Concretely: expose `disengage` on the schema whenever `autoResponseActive` is a meaningful concept for the session — i.e., any session backed by persistent tracking. This means mention-triggered sessions too.

## Risks / Trade-offs

- **Risk:** Claude disengages too eagerly after normal replies (false positive). → **Mitigation:** schema description emphasizes that user wording must be a clear dismissal; existing pre-analysis path on thread replies is unaffected.
- **Risk:** User disengages then wants Clack back without knowing about `@mention` re-activation. → **Mitigation:** already covered — the `Re-Activation via @Mention` requirement handles this. No new UX needed.
- **Risk:** Expanding `disengage` availability to mention sessions could re-disengage a thread the user just re-activated. → **Mitigation:** acceptable by design — if the user says "thanks, done" in a re-activated thread, that's still a dismissal.

## Migration Plan

No data migration. Existing sessions with `autoResponseActive` set are unaffected. The schema change is additive for clients (non-disengage calls keep working); the guard removal is the only behavior change, and it relaxes a constraint rather than tightening one.
