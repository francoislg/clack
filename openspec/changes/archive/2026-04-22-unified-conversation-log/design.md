## Context

`SessionContext` persists Q&A state across four overwrite-lossy fields (`originalQuestion`, `refinements[]`, `lastAnswer`, `lastResponse`) plus a dead `continuationHistory` declaration. Turn outcomes (`skip_response`, `disengage`, `post_top_level`) are accepted by `submit_response` but never persisted — they only influence runtime behavior. Per-turn `toolCallHistory` is session-scoped and overwritten each turn. Three consumers read these fields directly:
- `src/tools/query/findRecentInteractions.ts` reads `context.json` from disk, bypassing `getSession()`, and validates field names inline
- `src/sessions.ts::getSession` itself validates `originalQuestion` presence on load
- `.claude/skills/debug-session/SKILL.md` instructs the assistant to read `context.json` manually and references legacy field names

Session IDs are long-lived (30-day retention). ~500 persisted sessions scanned on each `find_recent_interactions` call.

## Goals / Non-Goals

**Goals:**
- Persist the full user↔assistant back-and-forth for every session so intermediate turns are recoverable
- Capture skip/disengage outcomes in the persisted log (currently invisible post-turn)
- Give call sites a single API (`messages[]` + selector functions) instead of four coupled fields
- Enable new recall shapes: channel-scoped queries, full-transcript retrieval, skipped-turn counts
- Delete dead code (`continuationHistory`)
- Convert existing on-disk sessions in one blocking migration at boot

**Non-Goals:**
- Changing `snapshots` (keyed by action id — different axis, stays separate)
- Persisting `threadContext` or `stagedIntents` (runtime-only by design)
- Absorbing unrelated fields (identity, delivery metadata, `activeChange`, `autoResponseActive`) — those stay where they are
- Supporting a dual-shape read path in production code beyond the migration itself
- Reconstructing lost per-turn timestamps for pre-migration data (best-effort single timestamp per legacy turn)

## Decisions

### 1. Single temporal `messages[]` log, not scattered fields

Replace the four lossy fields with a discriminated-union array:

```ts
type ConversationMessage = UserMessage | AssistantMessage;

type UserMessageSource = "initial" | "refinement" | "choice" | "followup";

interface UserMessage {
  role: "user";
  source: UserMessageSource;
  text: string;
  ts: number;
  value?: string;                 // only for source="choice" (machine value)
  imageFiles?: SlackImageFile[];  // only for source="initial"
}

interface AssistantMessage {
  role: "assistant";
  ts: number;
  // content (absent ⇒ skipped turn with no authored content)
  payload?: SubmitResponsePayload;      // { message?, blocks, actions }
  // turn outcome flags
  skipped?: true;
  disengaged?: true;
  postedTopLevel?: true;
  // per-turn execution trace
  toolCalls?: ToolCallRecord[];
  error?: ErrorRecord;
}
```

**Alternatives considered:**
- *Keep legacy fields, add a `messages[]` shim computed at read time.* Rejected: carries two writable code paths forever; every write site has to pick a path; the shim never goes away.
- *Keep four fields, add `previousAnswers[]` for history only.* Rejected: still fragmented, still needs choice/followup structure, doesn't solve skip persistence.

### 2. Static blocking migration, no dual-shape read path in production

At boot, a new `blocking`-priority migration iterates every directory under `data/sessions/`, reads each `context.json`, and rewrites it in the new shape. Migration version is bumped. All production code reads `messages[]` only — no fallback to legacy fields.

Shape conversion rules:
- `messages[0] = { role: "user", source: "initial", text: originalQuestion, ts: createdAt, imageFiles: imageFiles ?? undefined }`
- For each `refinement` in order, append `{ role: "user", source: "refinement", text, ts: createdAt }` — **all refinements share `createdAt`** (per-turn timestamps are lost pre-migration; accepted trade-off)
- If `lastAnswer` or `lastResponse` is set, append a single `{ role: "assistant", ts: lastActivity, payload: lastResponse, toolCalls: toolCallHistory }` at the end. `text` derived from `lastResponse.message` when present, else from `lastAnswer`.
- `continuationHistory` is discarded
- Legacy choice-refinements with the `"The user chose: "` prefix are **not** retroactively parsed into `source: "choice"` — they remain `source: "refinement"` with the prefix intact. Forward choices get structured `source: "choice"`.

**Alternatives considered:**
- *Enhancement-priority migration.* Rejected: enhancement migrations run in the background while handlers serve traffic, which would mean two shapes coexisting for live sessions during the window. Blocking eliminates that window.
- *Read-time shim forever.* See Decision 1.
- *Reconstruct per-refinement timestamps by interpolating between `createdAt` and `lastActivity`.* Rejected: false precision; confusing when displayed.

### 3. Selector module over direct field access

New `src/sessions/selectors.ts` exports pure functions over `SessionContext`:

```ts
firstUserMessage(s): UserMessage            // always messages[0], must be source: "initial"
latestAssistantMessage(s): AssistantMessage | undefined
latestAssistantText(s): string | undefined  // replaces lastAnswer
latestAssistantPayload(s): SubmitResponsePayload | undefined  // replaces lastResponse
userContinuations(s): UserMessage[]          // replaces refinements (non-initial user messages)
conversationLog(s): ConversationMessage[]    // the whole array
```

Call sites that read `session.lastAnswer` etc. switch to selectors. No call site outside `src/sessions.ts` and the migration reads raw `messages[]` or legacy fields.

### 4. Promote `toolCallHistory` and per-turn `errors[]` into `AssistantMessage`

- `toolCallHistory` becomes `AssistantMessage.toolCalls` (per-turn, not overwritten). The session-level `toolCallHistory` field is removed.
- `errors[]` stays on `SessionContext` for errors that cannot be attributed to a specific turn. Errors produced during a completed turn are additionally attached to the `AssistantMessage.error`. (During migration, pre-existing `errors[]` stays as-is on the session; no attempt to re-attribute.)

### 5. `find_recent_interactions` returns a lightweight summary; transcripts are a separate tool

List-view output per session:
```ts
{
  sessionId, channelId, channelName?, triggerType?, userId, displayName?,
  createdAt, lastActivity,
  firstQuestion: string,         // messages[0].text
  latestAssistantText?: string,  // latestAssistantText(session)
  messageCount: number,
  skippedTurnCount: number,
  assistantTurnCount: number,
}
```

No `payload` / `blocks` / `toolCalls` in list view — callers fetch detail via the new `find_session_transcript` tool. Keeps token budget predictable when listing many sessions.

Schema additions for `find_recent_interactions`:
- `channel?: string` — filter by specific channel ID (works for DM or public channel; visibility rules still apply)
- `trigger_type?: TriggerType` — filter by trigger (reaction, mention, dm, autoRespond, etc.)
- Pagination (`limit`, `offset`) already exists — keep.

New `find_session_transcript(sessionId, offset?, limit?)` tool:
- Resolves `sessionId`, applies same visibility rules as `find_recent_interactions` (owner always; others only if known public channel)
- Returns paginated `messages[]` with full `payload`, `toolCalls`, `error`, outcome flags
- Default `limit: 20`, max `100` — prevents blowing the context on a long-lived thread

### 6. Choice handler writes structured `source: "choice"`

`src/slack/handlers/choice.ts` currently writes `"The user chose: ${value}"` as a refinement string. New behavior:
```ts
messages.push({ role: "user", source: "choice", text: label, value, ts: Date.now() });
```

Prompt builder formats at render time: `"The user chose: ${m.text}" ` (matches current on-wire behavior for forward messages) — or tightens to `"${m.text} (value: ${m.value})"` if we want the prompt to see both. Default: keep existing render format; structure is about recall, not prompt change.

Similarly, followup action presses become `source: "followup"` with the prompt text.

### 7. Turn outcomes wired through `submit_response` → `handlerResponse`

`submit_response` currently returns `{ success: true, skipped?: true, disengaged?: true }` to Claude but discards the flags after the turn. Change: the `ClackToolsResult` interface exposes these flags; `handlerResponse` reads them when appending the `AssistantMessage` and sets `skipped`/`disengaged`/`postedTopLevel` accordingly. If skipped, no `payload` is set.

## Risks / Trade-offs

- **[Risk]** Migration fails mid-iteration leaving the data dir half-converted → **Mitigation**: migration writes to `context.json.new` then renames atomically per file; records per-file success in a migration log; on next boot re-attempts only unconverted files (idempotent: new-shape file has `messages` field, old shape does not — trivial detection).

- **[Risk]** Lost per-turn timestamps for pre-migration data produce misleading ordering in transcripts → **Mitigation**: `ts: createdAt` for all user refinements and `ts: lastActivity` for the single assistant turn is best-effort; document in the session-transcript spec that pre-migration sessions have coarse timestamps.

- **[Risk]** Unbounded growth of `messages[]` for long-lived threads inflates session files → **Mitigation**: 30-day retention already prunes; `find_session_transcript` pagination prevents unbounded tool output; no per-file size cap in this change but revisit if p99 file size becomes an issue.

- **[Risk]** `debug-session` skill drifts from the new shape → **Mitigation**: rewrite the skill documentation in this change (listed in tasks), validate by actually debugging a session during verification.

- **[Trade-off]** Choice presses pre-migration stay as `source: "refinement"` with `"The user chose: "` prefix, forward as `source: "choice"` — a two-shape history window. Accepted: retroactive parsing would be brittle, and the pre-migration window ages out in 30 days.

- **[Risk]** Direct filesystem reader (`findRecentInteractions.ts`) and the typed `getSession()` loader drift between validating old vs new fields during the change → **Mitigation**: both updated in the same change; type-level validator rejects files missing `messages` after migration.

## Migration Plan

1. Add new types (`ConversationMessage`, `UserMessage`, `AssistantMessage`) to `src/sessions.ts`. Keep legacy fields on `SessionContext` as *migration-only* types (in a separate `LegacySessionContext` interface scoped to the migration).
2. Write the blocking migration (`src/migrations/0XX-unified-conversation-log.ts` via `/create-migration`). Migration reads legacy shape, writes new shape, atomic rename per file.
3. Add selector module (`src/sessions/selectors.ts`) with tests.
4. Update writers: `handlerResponse.ts`, `choice.ts`, `followup.ts`, `submitResponse.ts` outcome capture.
5. Update readers: `promptBuilder.ts`, `resend.ts`, `dmActions.ts`, `findRecentInteractions.ts`, `getSession()` validator.
6. Remove legacy fields from `SessionContext`; remove `setLastAnswer`, `addRefinement` (or rename to `appendUserMessage` / `appendAssistantMessage`).
7. Add `find_session_transcript` tool + spec.
8. Update `find_recent_interactions` signature + tests.
9. Rewrite `.claude/skills/debug-session/SKILL.md`.
10. Verify end-to-end: fresh session, follow-up, choice button press, skipped auto-respond turn, error turn — all show correct shape on disk and in the new tools.

**Rollback:** migration is one-way. If catastrophic, operator can wipe `data/sessions/` (30-day retention makes this low-impact). A pre-migration backup tarball written during step 2 is feasible but not required for this change.

## Open Questions

- **Prompt builder render format for `source: "choice"`**: keep exact current format (`"The user chose: ${text}"`) or include the value explicitly? Default: keep current, revisit if prompts want the structure.
- **`stagedIntents` reset timing**: currently per-turn ephemeral. Does it become `AssistantMessage.stagedIntents` (attached to the turn that produced them) or stay session-level? Default: stay session-level — intents are consumed on the *next* user action, not the previous assistant turn, so coupling them to an assistant message confuses ownership.
- **Max `messages[]` length before pagination inside storage itself**: not addressed here. Assumption: never needed within the 30-day retention window. Revisit if we see >1000-message sessions in the wild.
