# Design — Investigation Relocation Fixes

## Context

Diagnosed from a live incident (thread `C07FDHPHXGQ/1786464157.108419` → investigation `C0BMJM59QAF/1786643620.640519`):

1. **Wrong requester.** `buildQueryContext` (`src/claude/index.ts:299`) sets `userId: session.userId` — the frozen session creator. On a reused multi-user thread, every tool that reads `ctx.userId` as "the user acting now" gets the thread starter instead of the current speaker. `start_investigation` passed Ayla as `requester`; the parent message read "@Ayla requested", `addedBy`/`startedBy`/session ownership were all Ayla, and the breadcrumb gate checked *Ayla's* preference.
2. **Stuck origin turn.** `bootstrapInvestigation` (`src/investigations/engine.ts:284`) `await`s `runInvestigationRound` — a full nested Claude query (with MCP attaches) — inside the caller's tool call. The origin turn blocked ~118s and died without a `tool_result` or `submit_response`; the origin thread saw nothing.
3. **Origin stays armed.** Relocation never touches the origin session's `attentionLevel` (it was `high`), so Clack keeps auto-responding in a thread the user explicitly moved away from.
4. **Findings leaked back into the followed thread.** The investigation session's `submit_response` calls attached `post_to` actions targeting the followed origin thread — round 1 staged one (`creation_context: "investigation-findings"`), and the root-cause round used **`auto: true`**, auto-posting mid-investigation findings into `#dev-team` with nobody asking. Two causes: (a) the "NEVER post to them" rule in `buildInvestigationDeliveryContext` is prompt-only — no validation stops a `post_to` at a followed thread; (b) the generic delivery context injected into the same session **contradicts it** ("Exception: if you investigated content from another thread … include `post_to` … so the user can share findings back to that thread"), actively steering Claude into the violation.

The shipped `requester-identity` change already resolves the per-turn speaker into `AskClaudeOptions.requester` — it just stops at the prompt.

## Goals / Non-Goals

**Goals:**

- `ctx.userId` = the current turn's speaker everywhere in query tools.
- `start_investigation` returns fast; the first round runs detached.
- The origin thread always gets a visible acknowledgment on tool-driven relocation.
- Relocating the current thread disengages its session (`attentionLevel → off`).
- Followed threads are structurally write-protected: no `post_to` reaches them unless the requester explicitly asked.

**Non-Goals:**

- Changing the reaction entry point (`investigateReaction.ts` already uses the reactor; its synchronous first round is out of scope — no origin turn is blocked there, the reaction handler has no reply obligation).
- Changing follow/drain mechanics, breadcrumb preference semantics, or the attention-level dial itself.
- Worker-mode context (`WorkerToolContext` has no per-turn speaker concept).

## Decisions

### D1 — Per-turn `ctx.userId` at the context-build seam (one line), not a parallel field

`src/claude/index.ts`: `userId: options?.requester?.userId ?? session.userId`.

- *Why here:* every query tool reads `ctx.userId`; fixing the source repairs the whole class (`start_investigation`, `follow_thread.addedBy`, `schedule_reminder`/`create_scheduled_message` attribution+ownership, `find_session_transcript`/`stop_tracking`/`find_recent_interactions` privacy checks) with no per-tool churn.
- *Alternative rejected:* a separate `ctx.requesterUserId` consumed only by investigation tools — smaller blast radius but leaves every other site subtly wrong and adds a second "who is the user" field that future tools will pick between incorrectly.
- *Deliberate semantic shift:* ownership/privacy checks now evaluate the **current speaker**. On a reused thread, user B asking for the transcript is judged as B (correct — B is the one asking), not as creator A. Scheduled triggers have no `requester` → falls back to `session.userId`, unchanged.
- The role is already per-turn (`options.role`), so role/user pairing stays consistent.

### D2 — Two-stage bootstrap: fast stage synchronous, first round detached

`bootstrapInvestigation` keeps stages 1–2 (+ breadcrumb) synchronous — resolve surface, duplicate/cycle guards, parent post, session create, `openInvestigation`, breadcrumb decision — and launches the first round detached (`void runInvestigationRound(...).catch(log)`) instead of `await`ing it.

- *Why:* the fast stage is a handful of Slack/API calls (sub-second-to-few-seconds); the round is an unbounded nested Claude query. The caller needs the permalink, not the findings.
- *All three entry points get the same shape* (tool, reaction, relocation) — one code path, no `detached?: boolean` flag. The reaction path also benefits (frees the reaction handler), and nothing there depended on round completion.
- *Ordering note:* the breadcrumb/ack may now land before the first findings post — acceptable; the parent message already anchors the investigation thread.
- *Alternative rejected:* keeping the round synchronous with a timeout — still blocks the origin turn for the timeout budget and adds a failure mode (round killed mid-flight).

### D3 — Ack contract via Claude's own `submit_response`, breadcrumb unchanged

The tool result and description direct Claude to reply in the origin thread with the investigation permalink (the existing "Investigate on the side" scenario already requires this — it was unreachable because the tool call starved the turn). D2 makes it reachable; no forced bot-post is added. The preference-gated bootstrap breadcrumb stays as-is (it exists for *non-conversational* entry points like the reaction).

- *Alternative rejected:* unconditional bootstrap-posted breadcrumb — overrides the user's explicit "silent" preference and double-posts next to Claude's ack.

### D4 — Disengage only on current-thread relocation, inside the tool

In `startInvestigation.ts`: when the effective origin is the current session's thread (no `thread_ref`, or `thread_ref` equals `ctx.session.channelId/threadTs`) and bootstrap returns `ok`, call `setAttentionLevel(ctx.session.sessionId, "off")` (from `src/sessions.ts:970`).

- *Why in the tool, not the engine:* the engine is entry-point-agnostic and doesn't know the caller's session; "the thread being left" is only meaningful on the conversational path. The reaction path reacts to arbitrary messages and has no engaged session to disengage.
- Investigating a *different* thread ("investigate that thread over there") does not disengage the current conversation — the user is still talking here.
- Disengage happens **before** Claude's ack `submit_response`; delivery of an in-flight turn's response is unaffected by attention level (which gates future auto-respond pre-analysis only). Re-engagement stays available via the existing paths (mention, re-engage reset to medium).
- The origin thread remains a `followAndInteract`/`follow` source — the investigation tee is independent of the origin session's attention level.

### D5 — Followed-thread write guard: validation-layer rejection with an explicit-request escape

`submit_response` gains a `blockedFollowedThreads` input (built from `ctx.session.followedThreads` at tool-assembly time, the same way `topLevelDeliveryChannel` flows in today). Batch validation rejects ANY `post_to` — `auto: true` or staged button alike — whose `(channel, thread_ts)` matches a followed thread, with an error naming the rule: followed threads are read-only sources. The ONLY escape is a `user_requested: true` field on the `post_to` action, documented as settable exclusively when the requester **explicitly asked, in the investigation thread, to post back to the source thread**; absent that field the rejection is unconditional.

- *Why validation, not prompt:* the incident happened WITH the "NEVER post to them" directive in the system prompt. A rule that matters this much ("VERY STRICT") must be structural — the existing `topLevelDeliveryChannel` rejection at `submitResponse.ts:502` is the proven pattern.
- *Why include staged buttons:* a button rendered in the investigation thread that cross-posts on click still originates from Claude's own initiative; strictness means the default path simply does not exist. When the user explicitly asks, `user_requested: true` covers both auto and staged forms.
- *Why an escape at all:* "unless EXPLICITLY ASKED" is part of the contract. Without an escape, a user saying "share that summary back to #dev-team" would dead-end. The flag is auditable in the session's tool-call log, and the validation error teaches the rule at the exact moment Claude tries to break it (the `submit_response` attach-hint precedent).
- *Channel-only `post_to` to the origin channel* (no `thread_ts`) is NOT blocked — the guard protects the followed *threads*; posting elsewhere in the channel is ordinary cross-posting.
- *Delivery-context contradiction:* investigation sessions suppress the generic "share findings back to that thread" exception paragraph — `buildInvestigationDeliveryContext` already owns the surface framing; the guard's error message replaces the generic guidance as the source of truth. The read-only directive gains the explicit-escape sentence so prompt and validation agree.
- *Alternative rejected:* prompt-only strengthening (stronger NEVER wording) — already proven insufficient by this incident.
- *Alternative rejected:* blocking at `bootstrapInvestigation`/engine level — the engine never sees Claude's `post_to` actions; `submit_response` is where every outbound post flows through.

## Risks / Trade-offs

- [Detached round failure is invisible to the caller] → `.catch` logs + the existing `runInvestigationRound` warn path; the investigation session/index already exist, so the next side-thread message or a manual nudge in the investigation thread re-drives it. Same posture as today's swallowed `try/catch` — but now the origin ack still happens.
- [Privacy-check semantics change on reused threads (D1)] → judged more-correct (the acting user is who's asking); flagged for review. Admins are unaffected (role checks are already per-turn).
- [Tests asserting `bootstrapInvestigation` awaited the round] → engine tests updated to assert the detached launch (spy called) rather than completion ordering.
- [User disengages, then immediately asks a follow-up in the origin thread] → intended behavior: mention re-engages; passive chatter no longer triggers Clack there. Documented in the tool result so Claude can tell users.
- [Claude sets `user_requested: true` without a real request] → residual prompt-trust, but now auditable (the flag is in the tool-call log), named in the field description as requiring an explicit in-thread request, and the default path is a hard error — a categorically higher bar than today's unguarded `post_to`.
- [Guard misses a followed thread added mid-session] → `blockedFollowedThreads` is read from the live session at each tool build; `follow_thread` updates `session.followedThreads` before the next `submit_response` builds.

## Migration Plan

Pure behavior change, no data/schema migration. Deploy normally; existing open investigations are unaffected (bootstrap-only changes). Rollback = revert commit.

## Open Questions

(none)
