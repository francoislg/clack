## Context

Plugin cron posts are channelless: the run's session is keyed `channelId: "channelless:<jobId>"` with a synthetic `threadTs`. The message it delivers lands in a real `(channel, threadTs)`, but nothing registers a session there. `findSessionByThread(channelId, threadTs)` (`src/sessions.ts:723`) matches `session.channelId === channelId && session.threadTs === threadTs`, so a human reply in the real thread resolves to `null`, and the thread auto-respond handler returns early (`src/slack/handlers/autoRespond.ts:216-221`) — there is no fallback to per-channel rule matching for thread replies.

The pieces to make engagement work already exist and are reused wholesale:
- `SessionContext` carries `attentionLevel` and `additionalSystemPrompt`.
- The thread-reply path consumes them: `findSessionByThread` → `isEngaged(session)` (`attentionLevel !== "off"`) → attention-rung pre-analysis gate → answer turn.
- `AutoRespondRule` already models the exact `(attentionLevel + extraContext)` shape, but scoped to a whole channel. This change is the same idea scoped to one thread.

## Goals / Non-Goals

**Goals:**
- One core primitive that seeds a discoverable, engaged session for a destination `(channel, threadRoot)` carrying a plugin-supplied `attentionLevel` + `followUpContext`.
- Two thin entry points over it: `deliver_to`/`post_to` schema fields (Claude-authored) and `sdk.engageThread(...)` (plugin code).
- Default `"off"` ⇒ no session seeded ⇒ identical to today. Opt-in, no migration.
- Trivia answers public clarifications on a pending question; casual threads stay conversational.

**Non-Goals:**
- No core concept of "question is pending/revealed" — trivia expresses the lifetime in its `followUpContext` ("re-read the original message"). Core stays state-agnostic.
- No per-thread `preAnalysisContext` — the attention rung is the only gate knob for now (`followUpContext` shapes the *answer*, not the gate). A per-thread pre-analysis hook is a possible later extension.
- No structural per-plugin attention default in config — attention is supplied per post; absent ⇒ off.
- The channelless run session is unchanged; we seed a *separate* destination session, not retrofit the channelless one.

## Decisions

### D1 — One primitive, two entry points
Add `registerThreadSession(channel, threadRoot, { attentionLevel, followUpContext })` to `src/sessions.ts` (name TBD). It creates a fresh `SessionContext` via the existing `createSession`, with `channelId = channel`, `messageTs = threadTs = threadRoot`, `attentionLevel`, and `additionalSystemPrompt = followUpContext`. `userId` is a synthetic placeholder (e.g. the plugin id) — when a human replies, the thread-reply turn uses the *reply author's* real userId for role resolution, so the seed's userId never gates a human. The seeded session carries no messages; it exists purely so `findSessionByThread` resolves and `isEngaged` passes.

- **deliver_to / post_to** (Claude path): the delivery wiring (`server.ts` `deliverToChannel` adapter; `autoExecute.ts` post_to auto-execute) calls `registerThreadSession` **after** a successful post, using the resolved root ts — the entry's `thread_ts` when set, else the posted message ts (mirrors the existing top-level `responseTs` tracking at `autoExecute.ts:561-563`).
- **SDK** (plugin path): `sdk.engageThread(channel, threadTs, opts)` wraps the same core. Trivia's `post_questions` calls it after each question's `chat.postMessage`.

**Alternative considered:** retrofit the channelless session to be discoverable from the destination thread (re-index `responseTs` under the destination channel, set its channelId). Rejected — it drags the channelless run's prompt/userId/trigger baggage into the human conversation; a fresh seed is cleaner and reuses `createSession` unchanged.

### D2 — `"off"` is the default and registers nothing
Every new field defaults to `"off"`/absent. `registerThreadSession` with `attentionLevel: "off"` is a no-op (no session written). This makes the schema fields and the SDK method purely additive: existing `deliver_to` calls, `post_to` actions, and plugin posts behave exactly as today until they pass a non-`off` level. No migration, no behavior change for un-opted plugins.

### D3 — Trivia lifetime via "re-read the original message", not core state
The trivia `followUpContext` instructs Clack to **re-read the original question message** before answering a reply: while it still shows as pending (not yet edited to reveal the answer) it may answer clarifications; once the message shows the revealed answer it must stop helping. The existing `threadAutoRespondMaxAgeMinutes` decay (default 60 min, `autoRespond.ts:232-239`) remains as a time backstop. Core needs no "pending" awareness.

### D4 — Anti-cheat carve-out co-located with the trivia context
`BASE_TRIVIA_CHECK_INSTRUCTION` (`triviaCheckInstruction.ts`) gains an explicit exception, using one self-contained good + one bad example: for the pending question "What is the largest province in Canada?", a **public** clarification request on its own thread ("do you mean by area or by population?") is legitimate and answerable; fishing for the answer ("is it Quebec?") is **still** cheating. Because both the trivia `followUpContext` and this instruction are loaded for the reply turn, they must agree — the spec for `trivia-cheating-detection` and `trivia-question-posting` share the same examples so they cannot drift.

### D5 — Plugins reach this only through the SDK
Per `src/plugins/CLAUDE.md`, trivia/casual must not import `src/sessions.ts`. Trivia uses `sdk.engageThread`; casual uses the `deliver_to` schema field (already Claude-authored, no core import). `engageThread` is the new SDK surface that wraps the core helper.

## Risks / Trade-offs

- **[`followUpContext` may not reach the answer turn]** → the seed stores it as `additionalSystemPrompt`; verify the thread-reply answer turn injects `session.additionalSystemPrompt` into the prompt (auto-respond rule `extraContext` already flows this way). If not wired for seeded sessions, wire it — covered in tasks.
- **[Cost: each engaged thread is a potential Claude run on every reply]** → the attention-rung pre-analysis gate filters noise; `"high"` biases toward responding but still gates. Trivia/casual volumes are low. `"off"` default means no new cost unless opted in.
- **[Anti-cheat and clarification context contradict]** → single source of truth: the same good/bad examples appear in both delta specs; the carve-out is scoped to the pending question's *own* thread only.
- **[Seeding clobbers an existing session for the same thread]** → register only when no session already exists for `(channel, threadRoot)`; if one exists, do not overwrite (a real Q&A already owns that thread).
- **[Trivia posts several questions per fire]** → one seed per question thread; low volume, each its own root ts. Acceptable.

## Migration Plan

None. Additive and backward-compatible — default `"off"` preserves current behavior for every existing delivery path and plugin. Rollback is removing the opt-in fields; no persisted data shape changes.

## Open Questions

- Final names: `registerThreadSession` vs `engageThread` (core) and the schema field spelling (`follow_up_context` vs `thread_context`).
- Whether `post_to` parity is in-scope for this change or deferred — included here since it rides the identical primitive at near-zero marginal cost, but it has no named consumer yet.
