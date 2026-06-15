## 1. Shared helper

- [x] 1.1 Add a zod schema for the inbound actions-block shape the rewrite touches (actions block with `action_id`-bearing button elements), co-located with the helper in `src/slack/`; non-actions blocks pass through untyped/unmodified.
- [x] 1.2 Implement `stripClickedButton(body: BlockAction)` returning `{ blocks, text }`: parse `body.message.blocks`, remove the element whose `action_id === body.actions[0].action_id`, drop an actions block (and the divider directly above it) when it becomes empty, and preserve `body.message.text`.
- [x] 1.3 Implement the missing/unparseable-blocks guard: signal "no rewrite" so callers leave the message untouched (never delete).
- [x] 1.4 Add unit tests for the helper: single-button removal drops the empty actions block + trailing divider; multi-button removal keeps siblings; non-actions blocks and `text` preserved verbatim; clicked button matched by `action_id`; missing-blocks guard returns the no-rewrite signal.

## 2. Handler migration

- [x] 2.1 `changeAction.ts`: replace `respond({ delete_original: true })` (Accept) with the helper-backed `replace_original` reply (or no-op when guarded).
- [x] 2.2 `configUpdateAction.ts`: replace the config-update-confirm `delete_original` with the helper-backed reply.
- [x] 2.3 `skillAction.ts`: replace the skill-action `delete_original` with the helper-backed reply.
- [x] 2.4 `changeThreadActions.ts` follow-up handler (Review/Merge/Update/Close): replace `delete_original` with the helper-backed reply.
- [x] 2.5 `changeThreadActions.ts` recovery handler (Continue/Start over/Discard): replace `delete_original` with the helper-backed reply.

## 3. Handler tests

- [x] 3.1 Update each migrated handler's tests: assert `replace_original: true` with filtered blocks + preserved `text` instead of `delete_original: true`; cover multi-button (siblings kept) where applicable and the missing-blocks no-delete path.

## 4. Verification

- [x] 4.1 Run `npx tsc`, `npx oxlint src/slack/`, `npx oxfmt --check`, and `npm test`; fix any failures.
- [x] 4.2 Confirm no remaining `delete_original: true` calls exist in `src/slack/handlers/` (grep) and `openspec validate preserve-message-on-action-click --strict` passes.
