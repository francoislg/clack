## Context

Button-mode hints deliver via `chat.postEphemeral({ thread_ts: body.message.ts, user })` in `src/plugins/trivia/answerTypes/hintButton.ts`. Slack drops threaded ephemerals when the parent thread has no replies, which is the default state for a posted trivia question — so the hint never appears and the button looks dead.

The freeform answer flow already opens a modal (`freeform.ts:344-411`, `client.views.open` driven off `body.trigger_id`), giving a proven in-plugin pattern to follow. A hint modal is strictly simpler than freeform's because it is read-only.

## Goals / Non-Goals

**Goals:**
- Hint delivery that always renders, regardless of thread reply state, and stays private to the clicker.
- Remove `chat.postEphemeral` from the hint path entirely.
- Preserve all existing non-delivery behavior: ack-first, click tracking (`clickedBy`) with dedupe and button-mode-only scope, missing-hint graceful fallback, no user-facing exposure of `clickedBy`.

**Non-Goals:**
- No change to inline-mode hints (they render in the message, no click).
- No change to hint generation, config cascade, `get_ideas`, `save_question`, or persistence.
- No view-submission handling — the modal has no inputs.

## Decisions

**Modal instead of channel-level ephemeral.** The minimal fix would be dropping `thread_ts` so the ephemeral lands in the channel main view. Rejected: it detaches the hint from the question and the user explicitly chose a modal. A modal is a per-trigger overlay — no thread context, always renders, private to the clicker — which matches the desired UX exactly.

**Display-only modal, no `registerView`.** The modal carries only a Close button (no `submit`). Slack emits a `view_submission` event only when a submit button exists, so no `sdk.registerView` handler is needed. This is the key simplification over freeform, which registers `/^freeform-modal:[^:]+$/` to handle answer submission.

**Handler sequence preserved; `trigger_id` added.** New order: `ack()` → parse questionId → resolve game + load question → `views.open({ trigger_id, view })` → update `clickedBy`. The question must be loaded before opening because the modal body embeds the hint text. Freeform does the same load-before-open against the same `trigger_id` and works in practice, so the ~3s `trigger_id` budget is not a concern here.

**New `buildHintModal` helper in its own file.** Mirrors `buildFreeformModal`'s separation (builder isolated from handler, independently testable). Builds a `modal` view: localized title (`hint.modal_title`), and a body section with the question statement + hint text, or the localized `hint.missing` fallback when no hint is present. No `callback_id` is required (nothing dispatches on close), but one may be set harmlessly for traceability.

**i18n.** Add `hint.modal_title` to EN (source of truth) and FR in `i18n/strings.ts`. Reuse the existing `hint.ephemeral_prefix` (the `💡 *Hint:* {text}` body line) and `hint.missing` keys — they already carry the right copy. Keep `button.hint` unchanged.

## Risks / Trade-offs

- **`trigger_id` expiry (~3s)** → The pre-open work is a couple of file reads, identical to the freeform path that already ships; acceptable. If it ever becomes a problem, the open could be reordered before the `clickedBy` write (already the case) — the write is post-open.
- **No fallback when `trigger_id`/client is missing** → Previously an ephemeral could still post; now nothing opens. Mitigation: this only happens on malformed payloads or a disconnected client (rare); the handler logs a warning and returns without throwing, consistent with freeform.
- **`hint.ephemeral_prefix` key name now misleading** → It still holds the correct `💡 *Hint:* {text}` copy used in the modal body. Renaming is cosmetic and would churn both locale files and tests; left as-is to keep the change focused. (Optional cleanup, not required.)
