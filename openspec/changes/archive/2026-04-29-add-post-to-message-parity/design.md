## Context

`submit_response` and `post_to` deliver Block Kit messages to Slack — top-level for `submit_response`, sideways for `post_to`. They share a delivery target (a Slack message) but diverged in surface: `submit_response` exposes `blocks` + `actions` + `reactions`, while `post_to` exposes only `blocks`. The asymmetry constrains Claude unnecessarily — it cannot post a poll to another channel with `Yes/No` buttons, cannot put a follow-up button on a cross-posted answer, and cannot auto-react to the cross-posted copy. The `send_to_thread` → `post_to` rename in migration v010 already signalled an intent to generalize this surface beyond simple cross-posting; the missing fields are the remaining gap.

## Goals / Non-Goals

**Goals:**
- Full message-content parity: `post_to` accepts `blocks`, `actions`, `reactions` with the same semantics as the top-level fields on `submit_response`.
- Structural sharing: a single `messageContentFields` zod fragment is the source of truth for both surfaces — adding a new content field updates both at once.
- Cross-posted action buttons work correctly: clicks resolve back to the original session's `intentStore` and snapshot store; ref-based actions (change/update/config_update) resolve refs as if the button had been clicked in the original thread.
- Both delivery paths (auto-execute and button-click) propagate the new fields.
- Persistence: snapshots used by the deferred (button-click) delivery carry `reactions` and `actions` so they replay correctly when the user clicks much later.
- Validators (`validateRefActions`, `validateActionButtonLabels`, `validateStagedIntentsCoverage`, `validatePostToActions`) walk `post_to.actions` so a staged intent placed inside `post_to.actions` is treated identically to one placed at the top level.

**Non-Goals:**
- Response-level fields on `post_to` (`message`, `skip_response`, `disengage`, `post_top_level`) — those describe the response itself, not the message content. The schema description already documents that `message` is excluded from cross-posting.
- Refactoring `submit_response` into a "list of posts" shape (where the in-thread response is just the first entry of `posts: [{ destination, ...content }]`). That's a deeper redesign worth doing only with concrete need.
- Click-time role re-checks for cross-posted action buttons — see *Decisions* and *Risks*.
- Unifying the streaming/typing-indicator delivery path (`submit_response`'s `buildDeliverFn`) with the simpler `chat.postMessage`-only path used by `post_to`. They share a reaction helper, not the full pipeline.

## Decisions

### 1. Spread `messageContentFields` into both schemas, do not fork

```ts
const messageContentFields = {
  blocks: z.array(BlockSchema).min(1).describe(...),
  actions: z.array(actionSchema).describe(...),
  reactions: z.array(z.string()).optional().describe(...),
};
```

Both `normalResponseSchema` (top-level submit_response) and `postToActionSchema` spread these fields. The `skipOptional*` variants stay separate (they make `blocks` / `actions` optional for the skip path) — they wrap, rather than replace, the shared fragment.

**Why this over forking the schemas**: structural lockstep beats discipline. Adding a new content field (e.g., a future `mentions: string[]`) requires one edit, not two, and the next person extending one surface cannot forget the other.

### 2. Reuse the recursive `actionSchema`; reject recursion at validation time

`actionSchema` is a discriminated union that includes `post_to`. Spreading `actions: z.array(actionSchema)` into `postToActionSchema` therefore makes nested `post_to` *parseable*. We disallow it at runtime in `validatePostToActions`:

> A `post_to` action SHALL NOT contain a nested `post_to` inside its `actions` array.

**Why this over forking a "non-post_to action union"**: a forked type would duplicate every other action variant (followup, choice, change, config_update, update), and adding a new action variant would need updating both unions. The runtime check is one line and gives a Claude-actionable error message.

### 3. Cross-posted action buttons route back to the original session

`getResponseActionBlocks(actions, sessionId)` already encodes button action IDs (`clack_post_to_<index>`, `clack_followup_<index>`, etc.) and writes the session ID into the button *value*. When `post_to` carries `actions`, we render those buttons at post time using **the original session's ID**. Click handlers decode the value, look up the session, and resolve refs (for `change`/`update`/`config_update`) against the original `intentStore`.

**Why this over a fresh session in the target channel**: ref-based actions reference intents staged earlier in the original session — those intents do not exist anywhere else. `followup`/`choice` clicks similarly need the original conversation context. Routing back is correct for every existing action variant. The downside is that follow-up replies happen in the original session/channel, not the cross-posted channel; that's surprising in some flows but consistent with the rest of Clack's button semantics.

### 4. Persist `reactions` and `actions` on the per-button snapshot

`submitResponse.ts` already persists `{ text, blocks }` in a snapshot per `post_to` action so the button-click handler can post the right content even after a delay. Extend the snapshot to `{ text, blocks, actions?, reactions? }`. The button-click path (`handlePostTo` in `dmActions.ts`) reads the snapshot and forwards everything to `postAnswerToChannel`.

**Why this over re-deriving from session state**: the snapshot is the authoritative record at the moment of submit; session state may evolve (further turns, more snapshots, intent expirations) before the click. Bundling the `actions`/`reactions` next to the blocks they belong to is the simplest invariant.

### 5. Extend the existing validators rather than adding new ones

- `validateRefActions` walks `actions` and verifies each `ref` resolves to a staged intent of the matching type. Extend it to also walk `post_to.actions`.
- `validateActionButtonLabels` enforces Slack's 75-char limit. Extend it to also walk `post_to.actions`.
- `validateStagedIntentsCoverage` ensures every staged intent is referenced by at least one action button. Extend it to also walk `post_to.actions`.
- `validatePostToActions` (existing) gains the nested-post_to check.

**Why this over adding parallel validators**: existing validators already encode the right semantics; there is no behavioral difference between a top-level button and a cross-posted button — they all become Slack action buttons with the same routing.

### 6. Defer click-time role re-checks for cross-posted buttons

Today's button click handlers do not re-verify the clicker's role against the role that authored the response. A user who sees a button is implicitly trusted to be a valid clicker — the button's *visibility* is the gate.

`post_to` widens visibility (the button now appears in possibly less-restricted channels), so we *could* require click-time role re-checks. We choose not to in this change because:

1. The existing pattern is consistent across all current button types; introducing role checks selectively for cross-posted buttons would create an inconsistent model.
2. Today's `propose_change` / `request_update` / `propose_config_update` tools already gate at *staging* time (only dev+/admin+ can stage them). The button only fires the staged intent — the original requester already had authority.
3. The right design for click-time authorization (per-action role minimum, channel-level read/write thresholds, owner overrides) deserves its own change.

This is captured as an *Open Question* below; if cross-posted buttons cause real exposure in practice, we'll revisit with proper scope.

## Risks / Trade-offs

- **[Authorization exposure]** A cross-posted button (`Apply Update`, `Start Change`) in a permissive channel can be clicked by users who, in the original channel, would not have seen it.
  → Mitigation: existing staging-time role checks still apply; the click only triggers a staged intent. If a clicker has no Slack-side rights to the target repo, the change handler's existing `repoAccess` checks reject the click.

- **[Snapshot lifetime drift]** If a session is cleaned up before a user clicks a cross-posted button, the action becomes inert.
  → Mitigation: same lifetime as today's `clack_post_to` button — no regression. The "link expired" friendly error path already exists.

- **[Surprising followup routing]** A `followup` button on a cross-posted message routes the next user turn to the *original* session/channel, not the cross-posted one.
  → Mitigation: documented in instruction text; consistent with all current button routing. If this surfaces as confusing in practice, revisit in a follow-up.

- **[Recursion potential]** `actionSchema` is recursive at the type level; nested `post_to` is parseable.
  → Mitigation: explicit rejection in `validatePostToActions` with an actionable error message naming the offending action index.

- **[Validator drift across nested action arrays]** Extending three validators to walk both top-level `actions` and `post_to.actions` introduces two iteration sites that must stay synchronized.
  → Mitigation: factor a small `forEachAction(payload, fn)` helper that yields every action with a path label (`actions[i]` or `actions[i].actions[j]`), and have each validator iterate via the helper. Single iteration site.

## Migration Plan

Pure additive change. No migration needed. Existing `post_to` callers (just `blocks`) work unchanged. Older Claude sessions that never emit `actions`/`reactions` on `post_to` are unaffected.

Rollback: revert the change. Snapshots persisted with `actions`/`reactions` after this ships will simply have those fields ignored on the rollback path (the button-click handler reads only `text`/`blocks` in the prior code).

## Open Questions

- **Should cross-posted action buttons re-check role at click time?** Deferred. Capture exposure incidents and revisit if the implicit-trust model proves uncomfortable.
- **Should `followup`/`choice` clicks on cross-posted messages route to the cross-posted channel instead of the original?** Current decision: original (consistent with existing routing). Reconsider if user research surfaces confusion.
- **Should we add a `post_top_level`-style flag to `post_to.actions` for "inherit reaction set from main response"?** Speculative — likely YAGNI until a concrete use case appears.
