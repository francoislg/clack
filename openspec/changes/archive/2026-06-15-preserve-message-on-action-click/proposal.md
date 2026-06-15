## Why

Five action-button handlers call `respond({ delete_original: true })`, which removes the **entire** message — text and buttons — when a button is clicked. That message is not actually disposable: it holds the proposal/prompt context that Claude re-reads from thread history on follow-ups, so deleting it drops context mid-workflow and the workflow loses the thread it was reasoning over.

## What Changes

- **BREAKING (UX):** Clicking an action button no longer deletes its message. The message content (all text/section blocks) is preserved; only the clicked button is removed from its actions block.
- A single shared helper rebuilds the message blocks from the interactive payload, removes the element whose `action_id` matches the clicked button, drops an actions block (and its trailing divider) only when it is left empty, and replies with `respond({ replace_original: true, blocks, text })`.
- The five handlers currently using `delete_original: true` switch to this helper:
  - `configUpdateAction.ts` (config-update confirm)
  - `skillAction.ts` (skill create/update/disable/restore)
  - `changeAction.ts` (Accept change proposal)
  - `changeThreadActions.ts` follow-up handler (Review / Merge / Update / Close)
  - `changeThreadActions.ts` recovery handler (Continue / Start over / Discard)
- The rebuilt blocks are read from the inbound Slack interactive payload through a small zod schema (per the repo convention that action payloads are zod-parsed, not hand-guarded), and the message `text` fallback is preserved alongside `blocks` so thread-history reads (`conversations.replies`) still surface the content.
- **Accepted tradeoff:** sibling buttons on multi-button messages remain live after a click (the clicked button is the only one removed). Re-firing the *same* action is still prevented because its button is gone.
- **Guard:** if the inbound payload has no message blocks, the handler leaves the message untouched rather than deleting it — the "no action deletes a message" invariant holds even on the edge case.

## Capabilities

### New Capabilities
- `action-button-message-preservation`: When an action button is clicked, the host message is preserved and only the clicked button is removed; no handler deletes the full message.

### Modified Capabilities
<!-- None — no existing spec defines the delete-on-click behavior. -->

## Impact

- **Code:** `src/slack/handlers/configUpdateAction.ts`, `skillAction.ts`, `changeAction.ts`, `changeThreadActions.ts`; one new shared helper (+ zod schema) in `src/slack/`.
- **Tests:** unit tests for the helper (button removed, empty-block drop, text/non-actions blocks preserved, missing-blocks guard); updated handler assertions (`delete_original` → `replace_original` + filtered blocks).
- **Behavior:** Claude now sees both the original proposal message and the streamed result in thread history — strictly more context. No data-model, config, or API changes.
