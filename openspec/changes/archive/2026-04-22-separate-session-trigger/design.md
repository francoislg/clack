## Context

The `unified-conversation-log` change (just archived functionally, still in-progress as a spec artifact) collapsed scattered fields into a `messages[]` array. During manual smoke-testing, two problems emerged:

1. **Bot-first sessions persist the cron prompt as a user message.** The cron job's instructions to Claude (e.g., "Send a message to the channel. The content is up to you…") end up in `messages[0]` as `role: "user", source: "initial"`. That's semantically wrong — no user wrote that message.
2. **`isAbortEdit` in `setupSession` is a hack.** To let user-first edits update `messages[0].text`, the reuse path compared `messageTs === session.messageTs`. For bot-first sessions, this check is always false (the session's messageTs is synthetic), so the branch is effectively dead. The asymmetry is confusing.
3. **Pre-analysis verdicts never reach the session file.** The autoRespond gate logs its decision to stdout only. Debugging autoRespond requires log correlation.

The fix is a structural refactor: split the trigger metadata away from the conversation log, and capture pre-analysis on the trigger (at session creation) plus each assistant turn.

## Goals / Non-Goals

**Goals:**
- Make `messages[]` a clean temporal log of Clack's assistant turns and user follow-ups — no synthetic entries.
- Give each trigger type its own typed shape (reactions carries emoji, scheduled carries prompt + jobId, etc.).
- Persist pre-analysis verdicts on the session file so debugging doesn't require log correlation.
- Remove the `isAbortEdit` special case; `setupSession` reuse path does one thing (append).
- Keep pre-migration on-disk session files readable via the existing lazy-synthesis path in `getSession`.

**Non-Goals:**
- One-shot data migration. Lazy synthesis handles both legacy-shape files and the first-wave `unified-conversation-log`-shape files on read; new writes use the new shape.
- Per-turn image attachments. Images live on `trigger.imageFiles` only (captured at session creation). Follow-up images in thread replies aren't tracked separately.
- Edit detection. For v1, a user edit to the triggering message is treated as a thread reply (appends a `source: "reply"` entry). Revisit if this is user-visible.
- Changing the `SessionTrigger.type` union to extend beyond the existing `TriggerType` values.

## Decisions

### Decision 1: Discriminated union with per-type fields (not a single shape)

Each trigger type carries the fields that are meaningful for it. `reactions` includes the emoji; `scheduled` has `prompt` + `jobId` and no `userId` field (the job's creator lives elsewhere); `autoRespond` has `ruleName` + `preAnalysis`.

**Alternatives considered:**
- Single shape with optional `emoji?`, `prompt?`, `ruleName?`. Cleaner type-wise but loses the exhaustiveness-check benefit when readers want to branch on type.
- Nested `metadata` bag. Defers the type problem; readers still need runtime narrowing.

**Rationale:** discriminated unions give readers a clean `switch (trigger.type)` experience and make it a type error to read `trigger.prompt` on a non-scheduled session.

### Decision 2: `messages[0]` becomes the first assistant turn (not a virtual user turn)

Sessions are created empty (`messages: []`); the first `SessionAssistantMessage` is appended when Clack delivers its first response. This means `messages[]` always has the shape `[assistant, (user|assistant)*]` — no synthetic pseudo-user entries.

**Alternatives considered:**
- Keep `messages[0]` as a synthetic `UserMessage` synthesized from the trigger. Readers get a stable "first user message" without understanding the trigger. But persists a fiction on disk.
- Always start `messages[]` with an explicit system/trigger entry. Same problem with a different label.

**Rationale:** `trigger` is the authoritative "what started this" field. `messages[]` is temporal reality. Selectors (`firstUserMessage`) can synthesize a virtual `UserMessage` from the trigger on read for compatibility with existing callers, but disk state stays clean.

### Decision 3: `preAnalysis` on both trigger AND per assistant turn

Captured on the trigger at session creation (for autoRespond-triggered sessions that reached Claude) and on each `SessionAssistantMessage` for autoRespond continuations (threadReply flows also run pre-analysis). A session with N assistant turns driven by autoRespond can have up to N+1 verdicts on disk (1 on trigger, N on messages).

**Alternatives considered:**
- Trigger only. Loses the verdict for every continuation turn.
- Separate `preAnalysisHistory[]` session field. Disconnects verdicts from the assistant turns they gated.

**Rationale:** co-locating each verdict with the assistant turn it gated gives a faithful audit trail. Trigger carries the session-creating verdict; assistant messages carry continuation verdicts.

### Decision 4: Always-append on reuse (no `isAbortEdit`)

`setupSession` reuse path appends a `SessionUserMessage { source: "reply" }` unconditionally. No comparison of `messageTs` against the session's stored ts.

**Alternatives considered:**
- Keep `isAbortEdit` but scope it correctly. Still a special case; bot-first triggers still take the append path.
- Detect edits via a distinct Slack event type. More accurate but requires separate handler wiring.

**Rationale:** edits are rare and the prompt builder's "ADDITIONAL INSTRUCTIONS FROM USER:" section renders edits as extra context — Claude sees both the original and the edit. The simpler code is worth the tiny information loss on edits.

### Decision 5: Selector-based compatibility layer

`firstUserMessage()` returns a virtual `SessionUserMessage` synthesized from the trigger. `userContinuations()` returns `messages[]` filtered to user entries. `latestAssistantText()` / `latestAssistantPayload()` walk `messages[]` as before.

**Rationale:** every reader that cared about "first user question" continues to work without touching the trigger/messages split. The split is only visible to writers and to readers that explicitly want both (e.g., `find_session_transcript` returns both fields).

### Decision 6: Lazy synthesis for both legacy AND first-wave formats

`synthesizeMessagesFromLegacy` now handles two on-disk shapes:
1. **Pre-unified-log** (originalQuestion + refinements + lastAnswer): convert to trigger + messages[].
2. **First-wave unified-log** (messages[0] is a user `source: "initial"`): lift `messages[0]` off `messages[]` into `trigger`, shift rest down. Convert `source: "initial"|"refinement"` to `"reply"` if encountered in continuation entries.

**Rationale:** production has both shapes persisted on disk. Lazy synthesis in the `getSession` loader handles both transparently. New writes are always in the final shape.

## Risks / Trade-offs

- **Risk**: Readers that bypass the selectors (if any) break. → **Mitigation**: grep for direct `.messages[0]` access; enforce selectors in the prompt builder and query tools. Tests cover the common access paths.
- **Risk**: First-wave on-disk sessions (written during the `unified-conversation-log` rollout) have `messages[0]` as user. The synthesizer must detect and reshape them. → **Mitigation**: the synthesizer's first check is "does a `trigger` field exist?" If yes, treat as already-new-shape; if no but `messages` is populated, lift `messages[0]` into trigger; else fall back to legacy field synthesis. Tests cover all three branches.
- **Risk**: `preAnalysis` is user-visible via `find_session_transcript` (which returns `messages[]` including per-turn `preAnalysis`). If pre-analysis content is sensitive, debuggers see it. → **Mitigation**: the field is already subject to session-visibility privacy gates; no new exposure surface.
- **Trade-off**: `CreateSessionOptions` signature changes (from `initialMessage` to `trigger`). All ~3 production callers and ~10 test fixtures need updates. Worth it for the cleaner shape.
- **Trade-off**: Edit-to-triggering-message becomes a `"reply"` entry. Slightly less clean than a dedicated `"edit"` source, but edits are rare and the promptBuilder handles them correctly via the refinements section.

## Migration Plan

No blocking one-shot migration. The `synthesizeMessagesFromLegacy` shim in `getSession` covers:
1. **Cold read of pre-`unified-conversation-log` sessions** (legacy fields): same as today — convert to `messages[]` on read.
2. **Cold read of first-wave `unified-conversation-log`-shape sessions** (has `messages` but no `trigger`): lift `messages[0]` into a synthesized `trigger`, drop the `source: "initial"` entry from `messages`, convert `source: "refinement"` to `"reply"` for subsequent user entries.
3. **Cold read of final-shape sessions** (has `trigger`): pass through.

First `updateSession` call after load writes the final shape. Stale sessions age out via the existing 30-day retention.

**Rollback**: reverting this change also reverts the synthesizer; on-disk sessions written in the new shape would fail validation in the old loader. In practice, any rollback needs a separate reverse-migration or we accept session loss. Given this is a cosmetic data-shape refactor, rollback is unlikely to be warranted.

## Open Questions

- Should `trigger.messageText` for `directMessages` type include the full verbatim DM, or the processed version (with @mentions transformed to display names)? Going with **processed**, matching the current behavior for `originalQuestion`.
- For `autoRespond` sessions that *skip* at the gate (pre-analysis says "ignore"), no session is created — should we persist the skipped-verdict trigger anyway for audit? **No** — skip-before-create stays in logs only. Only sessions that reach Claude get a file.
