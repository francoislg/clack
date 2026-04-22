## Why

Session persistence currently stores the Q&A conversation across four separate, lossy fields: `originalQuestion` (one-shot), `refinements[]` (user-only string log), `lastAnswer` (overwritten each turn), and `lastResponse` (overwritten each turn). Intermediate bot turns are lost on overwrite, user choice presses are squashed into a stringly-typed `"The user chose: ..."` prefix, turn outcomes like `skip_response` and `disengage` are never persisted at all, and a declared `continuationHistory` field has been dead code since introduction. Consumers — including `find_recent_interactions`, the `debug-session` skill, and the `resend`/`dmActions` handlers — each cope with this by reading fields piecemeal. The shape blocks richer recall (full-thread replay, channel-scoped queries, skip-trace) that we now want.

## What Changes

- **BREAKING**: Replace `originalQuestion`, `refinements[]`, `lastAnswer`, `lastResponse`, and `continuationHistory` on `SessionContext` with a single temporal `messages: ConversationMessage[]` log
- `ConversationMessage` is a discriminated union of `UserMessage` (with `source: "initial" | "refinement" | "choice" | "followup"`) and `AssistantMessage` (with optional `payload`, plus turn-outcome flags `skipped`, `disengaged`, `postedTopLevel`, plus per-turn `toolCalls` and `error`)
- Promote `toolCallHistory` (currently overwritten each turn) onto the per-turn `AssistantMessage.toolCalls`
- Promote single-element `errors[]` tied to a specific turn onto `AssistantMessage.error`; keep standalone `errors[]` on the session for non-turn-scoped failures
- Add a static blocking migration that rewrites every persisted `context.json` under `data/sessions/` from legacy to unified shape on startup; old field names removed entirely afterwards
- Extend `find_recent_interactions`: accept `channel` (channel ID) filter and return richer per-session summary (first question, latest assistant text, message count, skipped-turn count) while keeping the payload-heavy transcript out of list view
- Add new `find_session_transcript(sessionId, offset?, limit?)` query tool that returns paginated full `messages[]` including `payload`, `toolCalls`, and outcome flags, so callers can retrieve the full conversation on demand
- Add a selector module (`getFirstUserMessage`, `latestAssistantText`, `latestAssistantPayload`, `userContinuations`, `conversationLog`) to give call sites a stable API over the unified store
- **BREAKING**: Update the `debug-session` skill documentation to read from `messages[]` instead of legacy field names

## Capabilities

### New Capabilities

- `session-transcript-tool`: A query tool that returns the paginated full conversation transcript for a given sessionId, including per-turn payload/tool-calls/outcome flags

### Modified Capabilities

- `session-management`: Session persistence shape changes from four legacy fields to a single `messages[]` temporal log; adds migration requirement
- `find-recent-interactions`: Gains `channel` filter, returns richer summary fields, pagination semantics clarified
- `skip-response`: Skipped and disengaged turns must now persist as `AssistantMessage` records with `skipped: true` / `disengaged: true` (previously not persisted at all)
- `clack-tools`: Adds `find_session_transcript` to the query tool registry

## Impact

- **Code**: `src/sessions.ts` (type + persistence shape), `src/claude/promptBuilder.ts` (reads), `src/slack/handlers/handlerResponse.ts` (writes), `src/slack/handlers/resend.ts`, `src/slack/handlers/dmActions.ts`, `src/slack/handlers/choice.ts` (choice now writes structured), `src/slack/handlers/followup.ts`, `src/tools/query/findRecentInteractions.ts` (direct filesystem reader — must be updated), `src/tools/presentation/submitResponse.ts` (turn outcome capture)
- **Tool surface**: New `find_session_transcript` tool; updated `find_recent_interactions` output and schema
- **Persisted data**: Every file under `data/sessions/*/context.json` rewritten by a new blocking migration
- **Dependencies**: None — no new packages
- **Skills / docs**: `.claude/skills/debug-session/SKILL.md` documents direct reads of `originalQuestion`, `refinements`, `continuationHistory`, `lastResponse` and must be rewritten to read `messages[]`
- **OpenSpec**: Updates to `session-management`, `find-recent-interactions`, `skip-response`, `clack-tools` specs; new `session-transcript-tool` spec
- **Out of scope**: `snapshots` (keyed by action id, not temporal — stays separate); `stagedIntents` (per-turn ephemeral); `threadContext` (runtime-only, not persisted)
