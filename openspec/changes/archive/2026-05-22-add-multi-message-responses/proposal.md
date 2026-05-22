## Why

`submit_response` can deliver exactly one Slack message per call. This is right for ordinary thread replies (where a single structured message with headers/sections is the cleanest UX), but it falls short for *publishing-mode* deliverables — scheduled cron messages that want an "announcement + threaded detail" shape, or `post_to` cross-posts that want to land as a multi-part broadcast in another channel. Today Claude has to either cram everything into one message or chain multiple `post_to` actions, neither of which expresses the natural "primary post + follow-ups" structure.

## What Changes

- **`submit_response`** gains two optional fields, both mutually exclusive based on `post_top_level`:
  - `additional_messages: MessagePayload[]` — sibling messages in the same thread as the primary. Requires `post_top_level !== true`. Capped by config (default 5, bound `[1, 10]`).
  - `thread_replies: MessagePayload[]` — replies posted under the primary top-level message. Requires `post_top_level === true`. Sanity ceiling of 20 (fixed, not configurable).
- **Gating**: top-level `additional_messages` / `thread_replies` are only exposed in the schema when the session's deps carry `allowMultiMessage: true`. **Only the scheduled (cron) trigger flips this on.** Pure thread-reply contexts (DM, @mention, reaction) never see the fields — Claude cannot fragment a user's thread even if explicitly asked.
- **`post_to` actions** gain the same two fields with the same caps and the same mutual-exclusivity rule (driven by `post_to.thread_ts` instead of `post_top_level`). Available regardless of the deps gate, because creating a `post_to` is itself the explicit "publishing" opt-in.
- **Validation is all-at-once and atomic**: every error across the primary, every additional message, every thread reply, and every `post_to` payload is collected and returned together. If anything fails, the whole batch is refused — no partial delivery, no separate retry per item.
- **Sequential delivery, validation-atomic at the Slack boundary**: validation passing implies all-or-nothing as far as Claude-side correctness, but mid-batch Slack API failure (rare) results in a partial post that Claude can recover on the next turn. No rollback via `chat.delete`.
- **Per-message structure**: each `MessagePayload` carries `blocks` (required), `table?`, `actions?`, `reactions?` — the same shape as today's primary message minus `message`/`post_top_level`/`disengage`/`skip_response` (those are session-level signals, primary-only).
- **New config field**: `submitResponse.maxAdditionalMessages: number` in `config.json`, default 5, validated to `[1, 10]` at boot. Used by both top-level (scheduled) and `post_to` validators.

## Capabilities

### New Capabilities

(None — all changes extend the existing `clack-tool-response` capability.)

### Modified Capabilities

- `clack-tool-response`: `submit_response` accepts `additional_messages` and `thread_replies` (gated by `allowMultiMessage` deps); `post_to` actions accept the same fields (always); a new `submitResponse.maxAdditionalMessages` config field bounds the cap; batch validation collects all errors at once; delivery sequencing handles primary-then-followups with the correct `threadTs` plumbing.

## Impact

- **Affected code**:
  - `src/tools/presentation/submitResponse.ts` — new schema fields, cross-field validation, batch walkers, sequential delivery loop, snapshot-per-message
  - `src/tools/types.ts` — `SubmitResponsePayload` grows `additionalMessages?` / `threadReplies?`; `DeliverFn` gains optional `threadTs?`; `QueryToolContext` gains `allowMultiMessage?` and `maxAdditionalMessages?`
  - `src/tools/server.ts` — `SubmitResponseDeps` gains `allowMultiMessage` and `maxAdditionalMessages`; `ResponseCapture` grows to hold the batch
  - `src/tools/context.ts` — thread the new fields through `buildQueryContext`
  - `src/config.ts` — new `SubmitResponseConfig` type, parser with `[1, 10]` bound, default 5
  - `src/cron/` (or whichever module is the cron handler) — set `allowMultiMessage: true` when constructing scheduled-trigger deps
  - `src/slack/handlers/handlerResponse.ts` / wherever `DeliverFn` is implemented — handle `threadTs` parameter; streamer cleanup happens before primary only
  - Session-persistence layer — store array of rendered-blocks per response
- **New config field**: `submitResponse.maxAdditionalMessages` (optional, default 5). No migration needed — absence equals default.
- **Backward compatible**: when neither field is provided, behavior is byte-identical to today.
- **Tests**: extensive — schema gating per trigger, cross-field exclusivity, batch validation aggregation, sequential delivery + streamer-once, snapshot persistence per message, `post_to` extension, config parser bounds.
- **No breaking changes** to existing call sites — every current `submit_response` payload remains valid.
- **No migration**: new field is optional; old responses still parse.
