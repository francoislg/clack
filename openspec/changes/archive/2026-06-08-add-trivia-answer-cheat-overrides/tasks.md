# Tasks

## 1. Data model

- [x] 1.1 Add optional `originalVerdict?: { correct: boolean; judgeReason?: string }` to `SubmittedAnswer` in `src/plugins/trivia/core/types.ts` with a doc comment (absent = never overridden / machine-judged; present = admin-overridden, holds the machine's original verdict, skipped by reprocess re-derivation).

## 2. `override_answer` tool

- [x] 2.1 Create `src/plugins/trivia/tools/reveal/overrideAnswer.ts` — `tool("override_answer", ...)` with flat schema `{ game, questionId, userId, correct?, reason?, restore? }`; the description documents the two mutually-exclusive call shapes (override vs `restore: true`).
- [x] 2.2 Handler enforces the either-or (schema can't express it): override mode requires `correct` + non-empty `reason`; restore mode (`restore: true`) ignores them. Reject with a structured validation error on a malformed override call.
- [x] 2.3 Validate game via `requireWritableGame`; load the question; refuse with a structured error when `processedAt` is unset (post-reveal gate). Look up the `(userId, questionId)` row; return "answer not found" when absent.
- [x] 2.4 Override mode: `updateAnswer(userId, questionId, { correct, judgeReason: reason, originalVerdict })` where `originalVerdict` is set to the row's pre-override `{ correct, judgeReason? }` **only when absent** (capture-once); never touch the raw submission.
- [x] 2.5 Restore mode: when `originalVerdict` absent → "nothing to restore" error; otherwise `updateAnswer` sets `correct`/`judgeReason` back from `originalVerdict` and deletes `originalVerdict` (row re-enters reprocess).
- [x] 2.6 Return a `textResult` reporting the override/restore and pointing at the `compute_answers` reprocess → `update_answers_block` refresh path.
- [x] 2.7 Register in `src/plugins/trivia/index.ts` as an admin, always-on tool (NOT topic-gated); add its `label.*` i18n key.

## 3. Reprocess respects the lock

- [x] 3.1 In the freeform reveal handler (`src/plugins/trivia/answerTypes/freeform.ts`) and the shared reprocess re-derivation path, skip re-derivation for rows with `originalVerdict` set (no recompute, no re-judge) while still including them in the projected buckets with their stored verdict.
- [x] 3.2 Confirm boolean/choice handlers also skip re-derivation for overridden rows (verify the shared flow covers all three formats).

## 4. `remove_cheat` tool

- [x] 4.1 Add a `removeCheat({ cheaterUserId, questionId })` helper to the scoped data layer (`src/plugins/trivia/core/dataLayer.ts`) — rewrite `cheats.json` without matching entries, decrement the global `cheatAttempts` by the removed count (floored at 0), return `{ removedCount, totalAttempts }`.
- [x] 4.2 Create `src/plugins/trivia/tools/answers/removeCheat.ts` — `tool("remove_cheat", ...)` with schema `{ game, cheaterUserId, questionId }`; validate game; call the helper.
- [x] 4.3 Return "no matching cheat" no-op result when `removedCount === 0`; otherwise report `removedCount` + new total and the reprocess-refresh hint when the question was already revealed.
- [x] 4.4 Emit NO Slack message on removal.
- [x] 4.5 Register in `src/plugins/trivia/index.ts` as an admin, always-on tool; add its `label.*` i18n key.

## 5. Instruction

- [x] 5.1 Document both correction tools where the relevant trivia instruction lives (admin guidance): when to override a verdict vs. fix the key (`isTrue`/`correctIndex`) first for boolean/choice; how to refresh the posted card after a correction; that overrides survive reprocess.

## 6. Tests

- [x] 6.1 Unit: `override_answer` — override mode requires `correct`+`reason`, post-reveal gate, missing-row error, success captures `originalVerdict` once + sets verdict + reason, second override preserves the original; restore mode restores from `originalVerdict` and deletes it, restore with no `originalVerdict` errors; raw submission untouched, admin gating. Mock the data layer.
- [x] 6.2 Unit: reprocess preserves overridden rows — rows with `originalVerdict` are not re-derived but still projected; non-overridden rows still re-derive.
- [x] 6.3 Unit: `remove_cheat` — removes all matching entries, decrements counter, floors at 0, no-op on no match, no Slack message. Mock the data layer.
- [x] 6.4 i18n parity: new `label.*` keys present in `en` and `fr`.

## 7. Validate

- [x] 7.1 `openspec validate add-trivia-answer-cheat-overrides --strict`
- [x] 7.2 `npx tsc` clean; `npx oxlint` + `npx oxfmt --check` on touched files; `npm test` green.
