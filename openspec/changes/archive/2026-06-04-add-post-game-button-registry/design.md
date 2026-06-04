## Context

A revealed trivia question card carries up to two post-reveal buttons, each appended and managed in isolation:

- **"See your answer"** (`editCard.ts:80`) — persistent; its handler (`seeAnswerHandler.ts`) opens a private verdict modal and never removes the button.
- **"Tell me more"** (`editCard.ts:104`, gated by `if (tellMeMore)`) — one-shot; its handler (`tellMeMoreHandler.ts:99`) drops the button's own actions block via `chat.update`, then posts an intro and starts a thread conversation.

Both handlers share an identical shape — a `^<key>:[^:]+$` regex, a `plugin:trivia:<key>:` action-id prefix, an `extractQuestionId` parser, and (for one-shot) a `currentBlocks.filter(b => b.block_id !== id)` block-drop. The same is true of two *pre-reveal* buttons (`hint`, `freeform-answer`) that live on the question card before reveal — those are explicitly out of scope here.

The buttons are appended in separate `actions` blocks (not one shared block) precisely so a one-shot removal can drop a single block by `block_id` without disturbing its persistent sibling. That separation is the load-bearing property; the registry preserves it.

## Goals / Non-Goals

**Goals:**

- One declarative registry that owns every post-game button: its label, enablement, lifecycle, and click behavior.
- Three write-once shared helpers (render, install, remove) so adding a button is a single registry entry + its click logic — no edits to renderer/installer/remover.
- Behavior-preserving migration of `see-answer` and `tell-me-more`: identical `action_id`s, `block_id`s, ordering, and removal semantics.

**Non-Goals:**

- Migrating the pre-reveal `hint` / `freeform-answer` buttons (different host block, different timing).
- Giving Claude any control over which buttons exist or their layout — the reveal card stays fully deterministic.
- Combining the buttons into a single shared `actions` block / one visual row.
- Any config, data, migration, or i18n change.

## Decisions

### Decision 1: A declarative registry of `PostGameButton` entries

```ts
interface PostGameButtonContext {
  question: TriviaQuestion;
  game: TriviaGame | null;
  config: TriviaConfig;
}

interface PostGameButton {
  key: string;                                  // "see-answer" | "tell-me-more"
  blockId: (questionId: string) => string;      // existing strings, kept verbatim
  actionIdSuffix: (questionId: string) => string;// existing strings, kept verbatim
  label: () => string;                          // t("button.…")
  lifecycle: "persistent" | "one-shot";
  enabled: (ctx: PostGameButtonContext) => boolean;
  onClick: (handlerCtx: PostGameClickContext) => Promise<void>;
}
```

The registry is an ordered array; render order = array order. `see-answer` first, `tell-me-more` second — matching today's stacking.

**Why over the status quo:** the status quo duplicates the same four concerns across three files. A registry centralizes them and makes the section the single source of truth, which is the explicit ask ("a general post-game buttons concept").

### Decision 2: Keep existing `block_id`s and `action_id`s verbatim — do NOT introduce a unified prefix

The registry derives each button's `block_id`/`action_id` from per-entry functions that return the **current** strings:

- `reveal-see-answer-actions:<id>` / `reveal-see-answer:<id>`
- `reveal-tell-me-more-actions:<id>` / `tell-me-more:<id>`

**Alternative considered:** a unified `post-game-btn:<key>:<id>` scheme so the section is identifiable by a shared prefix. **Rejected** because (a) the section is already identifiable as "blocks whose id equals any registry entry's `blockId(qId)`" — no shared prefix needed; and (b) changing `block_id`s creates a cross-deploy edge: a card revealed before deploy carries old block-ids, so a post-deploy "Tell me more" click would fail to find the block and silently no-op (the remover treats not-found as already-removed). Keeping the strings verbatim makes this a true zero-observable-change refactor with no migration.

### Decision 3: Logical section, not one shared `actions` block

Each button keeps its own `actions` block (stacked rows, as today). The "section" is a logical grouping the remover and renderer understand via the registry, not a single Slack block.

**Alternative considered:** one shared `actions` block (buttons on one visual row). **Rejected** because one-shot removal would become element-splicing inside `elements` (plus conditional block-drop when it empties) instead of a one-line `block_id` filter — strictly more fragile, for a cosmetic row change nobody asked for.

### Decision 4: Three shared helpers

- `renderPostGameButtons(registry, ctx, actionId): KnownBlock[]` — maps enabled entries (`enabled(ctx) === true`) to one actions block each; `editCard.ts` appends the result below the footer/narrative. Replaces the `if (tellMeMore)` branch.
- `installPostGameButtons(sdk, registry, deps)` — for each entry, `sdk.registerAction(^<key>:[^:]+$, …)`. For `one-shot` entries it wraps `onClick` so the shared remover runs first (and the already-removed race short-circuits to no-op before `onClick`). Called from `index.ts` instead of the per-button install functions.
- `removePostGameButton(currentBlocks, button, questionId): { blocks; removed }` — the `currentBlocks.filter(b => b.block_id !== button.blockId(qId))` logic, written once. `removed === false` ⇒ already gone ⇒ caller no-ops.

`persistent` entries (`see-answer`) get an installer that registers `onClick` with no removal wrapper — its modal-opening behavior is unchanged.

### Decision 5: `enabled` subsumes the `tellMeMore` gate

`see-answer.enabled` returns `true` always; `tell-me-more.enabled` calls the existing `resolveTellMeMore(game, config).enabled`. `editCard.ts` stops taking a `tellMeMore: boolean` param — it passes the context and the registry decides. `update_answers_block` keeps resolving config (it already loads game + config) and hands them to the renderer via context.

## Risks / Trade-offs

- **[Race on double-click]** → Preserved exactly: the shared remover reports `removed: false` when the block is already gone, and the one-shot wrapper short-circuits before `onClick`, so no duplicate intro/thread — same guarantee as `tellMeMoreHandler.ts:101` today. Covered by the existing "already-removed is a no-op" scenario.
- **[Behavioral drift during migration]** → The existing `trivia-reveal-cards` and `trivia-tell-me-more` scenarios are the regression net; they must pass unchanged. The new `trivia-post-game-buttons` spec adds section/lifecycle scenarios on top.
- **[Over-abstraction for two buttons]** → Accepted deliberately: the user's stated driver is future buttons; the registry pays for itself by collapsing the existing three-file duplication even at N=2.
- **[Scope creep toward hint/freeform]** → Explicitly fenced out in Non-Goals; those live on the pre-reveal card and would need a `surface` axis the registry intentionally omits for now.
