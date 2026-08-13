# Investigation Relocation Fixes

## Why

A real relocation (`:clack-investigate:` in a busy `#dev-team` thread) exposed four defects sharing one seam: `start_investigation` attributes the investigation to the **frozen session creator** instead of the current speaker ("@Ayla requested" when François asked); the tool runs the entire first investigation round **synchronously inside the origin turn's tool call** (~2 min), starving the origin turn so it never replies — the thread looks stuck; relocation leaves the origin session's attention level armed, so Clack keeps auto-responding in a thread the user explicitly asked it to leave; and the investigation session **posted mid-investigation findings back into the followed origin thread** (a `post_to` with `auto: true`) — the "followed threads are inputs, never outputs" rule is prompt-only, and the generic delivery-context guidance actively invites the violation ("include `post_to` … so the user can share findings back to that thread").

## What Changes

- **Per-turn requester in the tool context.** `ctx.userId` in query tool contexts resolves to the current turn's speaker (falling back to the session creator when there is none, e.g. scheduled), extending the shipped `requester-identity` change from the prompt into tools. Fixes attribution in `start_investigation`, `follow_thread`'s `addedBy`, reminder/schedule attribution, and transcript-privacy ownership checks on reused multi-user threads.
- **Non-blocking relocation.** `bootstrapInvestigation` returns after the fast stage (create surface parent + session, follow origin, breadcrumb decision); the first investigation round runs detached instead of inline in the caller's tool call. `start_investigation` returns the permalink promptly so the origin turn can acknowledge.
- **Guaranteed origin acknowledgment.** A thread-relocation must always leave a visible trace in the origin thread — Claude's `submit_response` ack with the investigation link is the contract; the breadcrumb preference keeps governing the *extra* bootstrap-posted breadcrumb.
- **Disengage origin on relocation.** When `start_investigation` relocates the *current* thread (no explicit `thread_ref` to elsewhere), the origin session's attention level is set to `off` — Clack stops auto-responding there while the thread remains a read-only followed source feeding the investigation.
- **Structural followed-thread write guard.** `submit_response` validation REJECTS any `post_to` (auto or staged) targeting a followed thread of the current investigation session, unless Claude sets an explicit `user_requested` marker — permitted ONLY when the requester explicitly asked, in the investigation thread, to post back. The investigation delivery context also suppresses/overrides the generic "share findings back to that thread" exception that contradicts the read-only rule.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `requester-identity`: per-turn identity resolution extends beyond the prompt — the query tool context's `userId` SHALL be the current speaker, not the frozen session creator.
- `split-investigations`: bootstrap becomes two-stage (fast synchronous stage + detached first round); relocation of the current thread disengages the origin session's attention; the origin thread always receives an acknowledgment on tool-driven relocation; followed threads gain a structural write guard (`post_to` rejected unless explicitly user-requested).

## Impact

- `src/claude/index.ts` — `buildQueryContext({ userId: … })` sourcing.
- `src/investigations/engine.ts` — `bootstrapInvestigation` split; detached first round.
- `src/tools/actions/startInvestigation.ts` — disengage origin, prompt-fast return, ack contract in tool description/result.
- `src/sessions.ts` (`setAttentionLevel`) — new consumer, no behavior change.
- `src/tools/presentation/submitResponse.ts` — followed-thread `post_to` rejection (extends the existing target-channel rejection pattern, `topLevelDeliveryChannel`).
- `src/investigations/deliveryContext.ts` — strengthen the read-only directive; neutralize the generic delivery-context share-back exception for investigation sessions.
- Sessions on reused multi-user threads change ownership semantics for `find_session_transcript` / `stop_tracking` privacy checks (current speaker treated as the acting user) — deliberate, flagged in design.
