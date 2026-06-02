## 1. i18n

- [x] 1.1 Add `hint.modal_title` to `EN` and `FR` dictionaries in `src/plugins/trivia/i18n/strings.ts` (e.g. EN `"💡 Hint"`, FR `"💡 Indice"`); confirm the i18n parity test passes (no FR value identical to EN).

## 2. Modal builder

- [x] 2.1 Create `src/plugins/trivia/answerTypes/hintModal.ts` exporting `buildHintModal(...)` that returns a display-only `modal` view (Close button, no submit): localized title via `hint.modal_title`, body section containing the question statement plus the hint line (reusing `hint.ephemeral_prefix` for `💡 *Hint:* {text}`), or the localized `hint.missing` message when no hint is present.
- [x] 2.2 Add `src/plugins/trivia/answerTypes/hintModal.test.ts` covering: hint-present view (title + statement + hint text), missing-hint view (fallback body), and that the view has no submit button.

## 3. Handler

- [x] 3.1 In `src/plugins/trivia/answerTypes/hintButton.ts`, replace the `chat.postEphemeral` call with `client.views.open({ trigger_id, view })` built via `buildHintModal`; remove all ephemeral code paths.
- [x] 3.2 Extract `trigger_id` from the action body; if absent (or the Slack client is null), log a warning and return without throwing.
- [x] 3.3 Keep ack-first ordering, question-ID parse, game resolution, question load, and the `clickedBy` dedupe + button-mode-only tracking unchanged (tracking still runs after the modal opens).
- [x] 3.4 Update the file's header comment to describe the modal flow instead of the ephemeral flow.

## 4. Tests

- [x] 4.1 Rewrite `src/plugins/trivia/answerTypes/hintButton.test.ts`: assert `views.open` is called (not `postEphemeral`); cover first-click (modal opened + `clickedBy` becomes `["U123"]`), repeat-click (fresh modal, no duplicate), different-user (added to `clickedBy`), missing-hint (fallback modal, no `clickedBy` mutation, no throw), and missing-`trigger_id` (warn + return, no open, no throw).
- [x] 4.2 Swap the test's Slack-client stub from a `chat.postEphemeral` spy to a `views.open` spy.

## 5. Verify

- [x] 5.1 `npx tsc` clean; `npx oxlint` and `npx oxfmt --check` clean on touched files; `npm test` green.
- [x] 5.2 `openspec validate trivia-hint-modal --strict` passes.
