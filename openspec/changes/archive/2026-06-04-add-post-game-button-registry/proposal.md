## Why

The two post-reveal buttons on a trivia question card — "See your answer" and "Tell me more" — are each hand-wired separately: appended by bespoke branches in `editCard.ts`, removed by near-identical copy-pasted action handlers, with their block-id and action-id contracts restated in every file that touches them. Adding a third post-game button (e.g. "Explain the answer", "Report a mistake") today means editing the renderer, writing a new handler that re-implements the block-drop, and getting a fresh block-id/action-id contract right by hand. That does not scale — there is no single place that owns "the post-game buttons."

## What Changes

- Introduce a **post-game button registry**: one declarative list where each entry defines its key, localized label, enablement gate, lifecycle (`persistent` vs `one-shot`), and click behavior.
- Add three shared, write-once helpers driven by the registry:
  - a **renderer** that appends every enabled post-game button as a contiguous section below the reveal footer (replacing the hand-rolled `if (tellMeMore)` branch in `editCard.ts`),
  - an **installer** that registers one Slack action handler per entry at boot, wrapping `one-shot` entries with the static block-drop uniformly,
  - a **remover** that statically drops a one-shot button by its `block_id` while preserving every persistent button and the footer.
- Migrate the existing two buttons (`see-answer` = persistent, `tell-me-more` = one-shot) onto the registry. **No observable behavior changes**: identical `action_id`s, identical `block_id`s, identical rendering order, identical removal semantics.
- Adding a future post-game button becomes one registry entry + its click behavior — the renderer, installer, and remover need no edits.
- **Out of scope:** the pre-reveal live-card buttons (`hint`, `freeform-answer`) are NOT migrated; they live on the question card before reveal, on a different host block with a different lifecycle.

## Capabilities

### New Capabilities

- `trivia-post-game-buttons`: the registry that owns the set of buttons appended to a revealed question's card — their contiguous section layout, per-button enablement, `persistent`/`one-shot` lifecycle, static block-id-addressable removal that preserves sibling buttons, and the single-entry extension contract for adding new ones.

### Modified Capabilities

<!-- None. The refactor preserves every observable requirement in trivia-reveal-cards
     (the "See your answer" button + verdict modal) and trivia-tell-me-more (the
     "Tell me more" button + thread kickoff): same action_ids, same block_ids, same
     removal behavior. Those specs remain literally true; their button rendering and
     removal are now realized THROUGH the new trivia-post-game-buttons registry. -->

## Impact

- **Code (trivia plugin only):**
  - New: `src/plugins/trivia/revealCards/postGameButtons.ts` (registry + render/install/remove helpers).
  - Modified: `revealCards/editCard.ts` (delegate button append to the registry renderer).
  - Modified: `revealCards/tellMeMoreHandler.ts`, `revealCards/seeAnswerHandler.ts` (their click logic becomes registry entries; the block-drop moves into the shared remover).
  - Modified: `index.ts` (install handlers via the registry installer instead of one-by-one).
- **No config, data, migration, or i18n changes** — existing string keys and `tellMeMore` cascade are reused unchanged.
- **No cross-deploy concern** — keeping the existing `block_id`s means already-revealed cards posted before deploy still resolve correctly after deploy.
