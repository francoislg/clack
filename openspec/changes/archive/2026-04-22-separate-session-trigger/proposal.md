## Why

The just-landed `unified-conversation-log` change collapsed scattered session fields into a single `messages[]` log, but kept the convention that `messages[0]` is a `UserMessage { source: "initial" }` carrying the triggering text. That convention turned out to be wrong for bot-first sessions: scheduled cron jobs persist the internal cron *prompt* (an instruction given to Claude, not user-authored content) as a `role: "user"` entry. It also forced an awkward "abort-edit" hack in `setupSession` to keep `messages[0]` in sync with edits to the triggering Slack message. Finally, pre-analysis verdicts from the autoRespond gate are lost to stdout — they never reach the session file, so debugging autoRespond decisions requires logs.

The fix is a cleaner separation: the *trigger* (what started the session) is its own structured metadata field, and `messages[]` becomes a pure temporal log of what happened next — starting with Clack's first assistant turn.

## What Changes

- **BREAKING** — `SessionContext.messages[0]` is now always a `SessionAssistantMessage` (Clack's first response). Previously it was a `UserMessage { source: "initial" }`.
- **BREAKING** — Add required `SessionContext.trigger: SessionTrigger` — a discriminated union with per-type variations (`reactions`, `mentions`, `directMessages`, `autoRespond`, `scheduled`).
- **BREAKING** — Remove `source: "initial" | "refinement"` from `SessionUserMessageSource`. Replace with `"reply"`. (Remaining sources: `"reply" | "choice" | "followup"`.)
- **BREAKING** — Remove `SessionContext.imageFiles` top-level field. Image attachments from the triggering message live on `trigger.imageFiles` for user-first types.
- Add optional `preAnalysis?: string` to `SessionAssistantMessage`. Captured on every autoRespond-driven turn (including thread-reply continuations), so the autoRespond gate's decision is persisted per turn.
- Drop the `isAbortEdit` branching in `src/slack/handlers/core.ts::setupSession`. On session reuse, always append a `SessionUserMessage { source: "reply" }` — no special case for edits.
- Selectors (`firstUserMessage`, `triggerText`) and `promptBuilder` read the trigger for the "QUESTION:" line; the rest of `messages[]` for continuations.
- `synthesizeMessagesFromLegacy` updated to produce `(trigger, messages[])` from pre-unified-log on-disk files (best-effort trigger reconstruction from `triggerType` + `originalQuestion` + `imageFiles`).
- `find_session_transcript` returns `trigger` alongside `messages[]`. `find_recent_interactions` reads `firstQuestion` from `triggerText()`.

## Capabilities

### New Capabilities

- None. All behavior changes modify existing capabilities.

### Modified Capabilities

- `session-management`: replace the `Unified Conversation Log` and `Blocking Migration` requirements from `unified-conversation-log` with a new shape that separates `trigger` from `messages[]`. Drop `source: "initial"/"refinement"`; add `"reply"`. `messages[0]` becomes an assistant turn. Drop the abort-edit scenario.
- `session-transcript-tool`: the tool's return shape includes `trigger` alongside `messages[]`.
- `find-recent-interactions`: `firstQuestion` is derived via `triggerText()` (reads `trigger.messageText` or `trigger.prompt`); no longer requires scanning `messages[]` for a `source: "initial"` entry.
- `auto-respond-pre-analysis`: the gate's verdict is persisted — on the trigger at session creation (for autoRespond-triggered sessions) and on every assistant message for subsequent threadReply turns.
- `slack-message-trigger`, `slack-reaction-trigger`: the triggering message's text/userId/ts/imageFiles are stored on `trigger` instead of on `messages[0]`.

## Impact

- **Code**: `src/sessions.ts` (types, createSession, synthesizer, append APIs), `src/sessions/selectors.ts` (new `triggerText`, adjusted `firstUserMessage`), `src/slack/handlers/core.ts::setupSession` (build trigger on create, always-append on reuse), `src/slack/handlers/handlerResponse.ts` (stamp `preAnalysis` on appended assistant messages), `src/slack/handlers/autoRespond.ts` (pass pre-analysis verdict through), `src/cronScheduler.ts` (scheduled trigger wiring), `src/claude/promptBuilder.ts`, `src/tools/query/findSessionTranscript.ts`, `src/tools/query/findRecentInteractions.ts`, ~20 test files, `.claude/skills/debug-session/SKILL.md`.
- **API surface**: `CreateSessionOptions` replaces `initialMessage` with `trigger`. `ProcessMessageParams` gains optional `preAnalysis`.
- **On-disk data**: legacy-shape and first-wave `unified-conversation-log`-shape session files both still need to load. The synthesizer handles both: legacy fields → `trigger` + `messages[]`; first-wave `messages[0]-as-initial-user` → lift that entry off `messages[]` into `trigger`.
- **Dependencies**: none new.
- **Systems**: changes how `context.json` on disk is laid out. Lazy synthesis keeps old files readable; new writes use the new shape.
