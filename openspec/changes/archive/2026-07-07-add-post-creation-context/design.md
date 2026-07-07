## Context

Clack can post into a destination whose trigger it doesn't own via three paths that all converge on the same core primitive:

- `submit_response` `post_to` actions and `deliver_to` entries (Claude-authored) → `handlePostToAutoExecute` (`autoExecute.ts`).
- The plugin SDK `engageThread(channel, threadTs, opts)` (`sdk.ts`), used by e.g. trivia's `post_questions`.

Both funnel into `registerThreadSession` (thread destinations) or `seedEphemeralRule` (top-level channel posts). Today the accompanying guidance travels as `followUpContext`, which is stored as the seeded session's `additionalSystemPrompt` (threads) or the ephemeral rule's `followUpContext` (top-level). It is consumed only when a human reply reaches the **answer turn** — via `promptBuilder` for threads (`session.additionalSystemPrompt` injected as "ADMINISTRATOR INSTRUCTIONS") and `buildChannelReplyPrompt` for ephemeral rules.

The **pre-analysis judge** (`runPreAnalysis` / `runActiveRunPreAnalysis` in `preAnalysis.ts`), which decides *whether* to auto-respond, never sees this guidance on the thread path — it receives a fixed `THREAD_PRE_ANALYSIS_CONTEXT` constant plus `sharedContext`. The top-level ephemeral path feeds the judge a separate `rule.preAnalysisContext` (used by standing admin rules), not the seeded `followUpContext`. So a Clack-initiated conversation's reason-for-existing is invisible to the gate.

## Goals / Non-Goals

**Goals:**
- A single, required, well-named `creation_context` field on `post_to` / `deliver_to` carrying the post's provenance/background.
- That context reaches BOTH the pre-analysis judge and the answer turn, on both the thread and top-level ephemeral paths.
- Store it as a first-class `SessionContext.creationContext` field, distinct from the catch-all `additionalSystemPrompt`, so the judge reads it unambiguously.
- One consistent name across the whole primitive (tool schema, core helper, ephemeral rule, plugin SDK, trivia) — no half-rename.

**Non-Goals:**
- No `creation_context` on the **primary** `submit_response` (the primary delivers into the user's own conversation; nothing hidden to seed).
- No change to how standing (non-ephemeral) admin auto-respond rules feed `preAnalysisContext` to the judge.
- No structured/JSON payload — `creation_context` is a plain instruction string Claude reads.
- No data migration (the new session field is additive/graceful).

## Decisions

### 1. Replace `follow_up_context` with `creation_context` (not add alongside)
Exposing both a `context`-style field and `follow_up_context` invites Claude to conflate them and split intent across two fields. A single required field with broadened semantics is cleaner. Chosen name `creation_context` (over `hidden_context` / `initial_context`): it names the provenance neutrally — the context the post was *created* with — without implying secrecy (the content is background, not necessarily secret) and without implying it's merely a "starting" value that gets superseded.

Alternative considered: keep `follow_up_context` at the tool boundary, add judge-feeding internally. Rejected — the field's narrow "how to handle clarification requests" framing understates the general provenance role, and the user explicitly wants a merge.

### 2. Dedicated `SessionContext.creationContext` field, not `additionalSystemPrompt`
`additionalSystemPrompt` is a catch-all set by multiple flows (plugin engagement, channel-reply handoff, `buildChannelReplyPrompt`). Feeding the whole of it to the judge would leak unrelated instructions and vary by flow. A dedicated `creationContext` field lets both the judge and the answer turn read exactly the seeded provenance. `promptBuilder` gains a distinct labeled block for it; the existing `additionalSystemPrompt` injection is untouched.

Migration impact: none. The field is optional and additive; existing seeded sessions (which used `additionalSystemPrompt`) keep working because that injection path is preserved. New writes populate `creationContext` instead.

### 3. Feed the judge by extending the existing context string — no signature churn
`runPreAnalysis`/`runActiveRunPreAnalysis` already accept a `preAnalysisContext` string. The thread path appends `session.creationContext` to `THREAD_PRE_ANALYSIS_CONTEXT`; the top-level ephemeral path appends `rule.creationContext` to whatever context it already passes. No new parameters — the wiring is a string concatenation at the two call sites in `autoRespond.ts`.

### 4. Required at the tool boundary, optional in the internal/plugin API
The schema field (`post_to`, `deliver_to`) is **required** so Claude always records why it posted. The internal `EngageThreadOptions.creationContext` and the SDK `engageThread` option stay **optional** — plugins and internal handoffs (e.g. `handlerResponse` channel-reply handoff, which forwards the anchor session's `additionalSystemPrompt`) may legitimately have nothing to seed.

### 5. Ephemeral-rule field rename with a short-TTL legacy read
Ephemeral rules are persisted state read by a graceful (permissive) zod schema. Rename `followUpContext` → `creationContext`, but accept a legacy `followUpContext` on read and map it, so rules seeded just before a deploy don't lose their guidance. Ephemeral rules carry a TTL (minutes), so the legacy branch is a safety net, not a long-term shape.

## Risks / Trade-offs

- **[Judge over-eagerness]** Feeding provenance to the classifier could bias it toward responding when it shouldn't → `creation_context` is appended as *context*, not as an instruction to always engage; the existing direct-address / thread-tone policy still governs the verdict. The trivia pending-question path already wants the judge to understand the thread, so this is aligned.
- **[Trivia behavior shift]** Trivia's pending-question guidance now also reaches its thread judge → desirable (it helps the gate distinguish clarification from answer-fishing, matching the cheating-detection carve-out), and low-risk since the guidance is descriptive.
- **[BREAKING tool schema]** Renaming + requiring the field changes the Claude-facing contract → acceptable; the field is internal to Clack's own tool server (no external consumers), and the instruction/description update lands with the schema.
- **[Legacy ephemeral rules]** A rule persisted under the old field name mid-deploy → mitigated by the legacy read in the ephemeral-rule schema.
