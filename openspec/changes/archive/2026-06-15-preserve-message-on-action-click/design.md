## Context

Action-button handlers in `src/slack/handlers/` reply to a button click via Bolt's `respond()` (backed by the interaction `response_url`). Five of them call `respond({ delete_original: true })`, deleting the whole host message:

- `configUpdateAction.ts` — config-update confirm
- `skillAction.ts` — skill create/update/disable/restore
- `changeAction.ts` — Accept change proposal
- `changeThreadActions.ts` — follow-up (Review/Merge/Update/Close) and recovery (Continue/Start over/Discard)

These messages carry the proposal/prompt text that Claude re-reads from thread history (`conversations.replies`) on follow-ups. Deleting them drops context mid-workflow.

Each button is built with a globally-unique `action_id` of the form `clack_<type>_<index>` (`actionToButton`, `blocks.ts:171`). The inbound `BlockAction` payload provides `body.actions[0].action_id` (which button fired) and `body.message.blocks` / `body.message.text` (the full host message). The conversational handlers (`resend.ts`, `choice.ts`, `followup.ts`, `retry.ts`) already preserve their messages via `replace_original` / streaming — they are the precedent, not part of this change.

## Goals / Non-Goals

**Goals:**
- No action-button handler ever deletes its host message.
- Clicking a button removes exactly that button; all text/section blocks and the message `text` fallback survive verbatim.
- One shared helper, reused by all five handlers, so the behavior is defined once.
- Inbound payload blocks are read through a zod schema, per repo convention.

**Non-Goals:**
- Disabling or removing sibling buttons (they stay live — accepted tradeoff).
- Replacing buttons with a status/audit note (rejected option from exploration).
- Touching the conversational handlers, the block builders (`blocks.ts`), or any post-action streaming/result logic.
- Changing what work each handler performs after the reply.

## Decisions

**1. Strip only the clicked button; never delete.**
Replace `respond({ delete_original: true })` with `respond({ replace_original: true, blocks, text })` where `blocks` is the original message blocks minus the clicked element. Rationale: preserves the context Claude needs while still preventing re-fire of the same action (its button is gone). Alternative considered — keep deleting but re-post context into the streamed result — rejected: duplicates content and still loses the original thread message.

**2. Match the clicked element by `action_id`.**
`action_id` is globally unique per message (`clack_<type>_<index>`), so filtering the actions block's `elements` by `action_id !== body.actions[0].action_id` removes exactly one button with no ambiguity. No need to also match `value`.

**3. Drop an actions block (and its trailing divider) only when it becomes empty.**
Single-button messages (Accept, config confirm, skill) leave an empty actions block after removal; an empty actions block is invalid and a dangling `divider` looks broken. Remove both in that case. Multi-button messages keep the block with the remaining buttons.

**4. One shared helper in `src/slack/`.**
Signature roughly `stripClickedButton(body: BlockAction): { blocks; text }`. All five call sites become `await respond({ replace_original: true, ...stripClickedButton(body) })`. Rationale: DRY — the transform is identical across handlers; a per-handler copy would drift.

**5. Parse inbound message blocks with zod, not casts.**
`body.message.blocks` is loosely typed by Bolt. Per the repo convention (action/modal payloads parsed through a zod schema, graceful reader: on mismatch log + fall back), the helper validates the actions-block shape it manipulates and passes other blocks through untouched.

**6. Missing-blocks guard.**
If `body.message?.blocks` is absent/unparseable, the helper signals "no rewrite"; the handler then leaves the message untouched (does **not** delete). This preserves the invariant even on the edge case.

## Risks / Trade-offs

- **Sibling buttons remain re-clickable on multi-button messages** → Accepted by the user. After clicking Merge, Review/Update/Close stay live on a possibly in-flight workflow. Mitigation if it bites later: a follow-up change could *disable* siblings instead of keeping them, without revisiting the no-delete invariant.
- **`respond` after the work vs. before** → Today some handlers delete *before* doing the work. The rewrite keeps the same ordering (reply first, then act); the only change is the reply payload, so timing/latency is unchanged.
- **Loosely-typed Bolt blocks** → Mitigated by the zod schema + graceful fallback; unknown block types pass through unmodified.
- **Stale `text` fallback** → The original `body.message.text` is preserved as-is; not regenerated, so it cannot drift from the surviving blocks.
