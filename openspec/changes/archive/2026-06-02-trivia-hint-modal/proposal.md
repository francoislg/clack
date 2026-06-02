## Why

Button-mode hints are silently broken. On click, the handler posts an ephemeral message scoped to the question's thread (`thread_ts: body.message.ts`). When that thread has no replies — the normal state for a freshly posted trivia question — Slack does not render the threaded ephemeral, so the clicker sees nothing happen. The "💡 Get Hint!" button appears dead.

## What Changes

- **BREAKING** (behavioral): button-mode hints stop using `chat.postEphemeral` entirely. On click, the handler opens a **modal** via `client.views.open` instead. A modal is a per-trigger overlay with no thread context, so it always renders and stays private to the clicker.
- The modal is **display-only**: a title plus the question statement and the hint text, with Slack's built-in Close button. There is no submit, so no `view_submission` handler is registered.
- Missing-hint fallback (stale message / edited record) opens a modal showing the localized "No hint available" message instead of an ephemeral.
- A new `buildHintModal` helper builds the view; a new `hint.modal_title` i18n key (EN + FR) supplies the title; the existing `hint.missing` key supplies the fallback body.
- Unchanged: ack-first, question-ID parse, game resolution, question load, `clickedBy` dedupe, button-mode-only click tracking, and the rule that `clickedBy` is never surfaced user-facing.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `trivia-question-hints`: the "Hint button handler posts ephemeral and tracks clicks" requirement changes — the delivery mechanism becomes a modal (`views.open`) rather than an ephemeral (`chat.postEphemeral`). Click-tracking behavior is unchanged.

## Impact

- `src/plugins/trivia/answerTypes/hintButton.ts` — handler swaps `postEphemeral` for `views.open`; adds `trigger_id` extraction and a guard for missing trigger/client.
- `src/plugins/trivia/answerTypes/hintButton.test.ts` — assertions move from `postEphemeral` to `views.open`.
- New `buildHintModal` helper (new file under `answerTypes/`) + its test.
- `src/plugins/trivia/i18n/strings.ts` — add `hint.modal_title` (EN + FR).
- No change to rendering (`renderHint.ts`), config cascade, `get_ideas`, `save_question`, or persistence. No dependency changes.
