## ADDED Requirements

### Requirement: Post-game buttons are defined in a single registry

The trivia plugin SHALL define the set of buttons appended to a revealed question's card in one declarative registry. Each registry entry SHALL declare: a stable `key`, a localized label, a `block_id` derivation, an `action_id` derivation, an enablement predicate, a lifecycle of `persistent` or `one-shot`, and a click behavior. The registry SHALL be the single source of truth for which post-game buttons exist; the reveal renderer, the boot-time handler installer, and the click-time remover SHALL all be driven by it. Adding a new post-game button SHALL require only a new registry entry (plus its click behavior) — with no edits to the renderer, installer, or remover.

The initial registry SHALL contain exactly two entries: `see-answer` (`persistent`) and `tell-me-more` (`one-shot`).

#### Scenario: Registry drives the full set

- **WHEN** the plugin renders and installs post-game buttons
- **THEN** the set of buttons rendered and the set of handlers installed are both derived from the registry entries
- **AND** no post-game button exists outside the registry

#### Scenario: Adding a button is a single registry entry

- **WHEN** a new post-game button is introduced by adding one registry entry with its key, label, lifecycle, enablement, and click behavior
- **THEN** the button is rendered, its handler installed, and (if `one-shot`) its removal handled, with no change to the shared renderer, installer, or remover

### Requirement: Post-game buttons render as a contiguous section below the reveal footer

When a question is edited into its final reveal state, the renderer SHALL append every registry entry whose enablement predicate returns true as a contiguous section placed below the reveal footer (and below any reveal narrative), each button in its own `actions` block, in registry order. A button whose enablement predicate returns false SHALL NOT be rendered. The renderer SHALL preserve each entry's existing `block_id` and `action_id` strings verbatim.

#### Scenario: Enabled buttons render in registry order

- **WHEN** a question is edited at reveal with both `see-answer` and `tell-me-more` enabled
- **THEN** the card shows the "See your answer" button followed by the "Tell me more" button, each in its own actions block, below the results footer

#### Scenario: Disabled button is omitted

- **WHEN** a question is edited at reveal and the `tell-me-more` entry's enablement predicate returns false
- **THEN** only the "See your answer" button is rendered and no "Tell me more" button appears

#### Scenario: Block and action ids are preserved verbatim

- **WHEN** the section is rendered
- **THEN** the "See your answer" button uses `block_id` `reveal-see-answer-actions:<questionId>` and `action_id` `reveal-see-answer:<questionId>`
- **AND** the "Tell me more" button uses `block_id` `reveal-tell-me-more-actions:<questionId>` and `action_id` `tell-me-more:<questionId>`

### Requirement: Each post-game button is independently installed and addressable

For each registry entry the plugin SHALL register exactly one Slack action handler at boot, matched by a regex on the entry's `action_id` suffix, serving that button on every question. For a `one-shot` entry the installer SHALL wrap the click so the shared remover runs before the entry's click behavior. For a `persistent` entry the installer SHALL register the click behavior with no removal step.

#### Scenario: One handler per entry serves all questions

- **WHEN** the plugin installs post-game buttons at boot
- **THEN** exactly one handler is registered per registry entry, each regex-matched to cover every question

#### Scenario: Persistent button is never removed on click

- **WHEN** a `persistent` button (e.g. "See your answer") is clicked
- **THEN** the button remains on the card and its click behavior runs

### Requirement: One-shot removal preserves sibling buttons and the footer

The shared remover SHALL statically remove a `one-shot` button by filtering out the block whose `block_id` matches that entry's derivation for the question, leaving every other post-game button (including all `persistent` buttons) and the reveal footer intact. When the targeted block is already absent, the remover SHALL report no removal and the click handler SHALL treat it as a no-op (no duplicate side effects). Removal SHALL be applied via `chat.update` so it is visible to all viewers of the shared card.

#### Scenario: One-shot removal keeps the persistent button

- **WHEN** the "Tell me more" (one-shot) button is clicked
- **THEN** the "Tell me more" actions block is removed from the card
- **AND** the "See your answer" (persistent) button and the reveal footer remain

#### Scenario: Already-removed one-shot is a no-op

- **WHEN** two clicks of a one-shot button race and the first has already removed its block
- **THEN** the second click reports no removal and performs no further side effects (no duplicate intro, conversation, or update)

#### Scenario: Removal is global

- **WHEN** any user clicks a one-shot post-game button
- **THEN** the card is updated via `chat.update` and the button's removal is visible to all viewers of the message
