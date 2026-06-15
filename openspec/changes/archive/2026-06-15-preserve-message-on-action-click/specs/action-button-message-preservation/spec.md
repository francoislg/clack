## ADDED Requirements

### Requirement: Action-button clicks preserve the host message

When a user clicks an action button, the handler SHALL preserve the host message and SHALL NOT delete it. No action-button handler SHALL reply with `delete_original: true`. The reply SHALL use `replace_original: true`, carrying the original message's surviving blocks and its `text` fallback unchanged.

This applies to every handler that previously deleted its message on click: the config-update confirm button, the skill action buttons (create / update / disable / restore), the Accept change-proposal button, the change follow-up buttons (Review / Merge / Update / Close), and the recovery buttons (Continue / Start over / Discard).

#### Scenario: Single-button proposal message survives the click

- **WHEN** a user clicks the only button on a message (e.g. Accept change, config-update confirm, or a skill action)
- **THEN** the message is not deleted
- **AND** all text and section blocks remain, with the original `text` fallback preserved
- **AND** the now-empty actions block and any trailing divider directly above it are removed

#### Scenario: Multi-button message keeps siblings

- **WHEN** a user clicks one button on a message that has several (e.g. clicks Merge on a Review / Merge / Update / Close follow-up message)
- **THEN** the message is not deleted
- **AND** only the clicked button is removed from its actions block
- **AND** the remaining sibling buttons stay present and clickable

### Requirement: Clicked button is removed by action_id

The shared rewrite SHALL identify the clicked button by matching `body.actions[0].action_id` against the `action_id` of each element in the message's actions blocks, removing the single matching element. Because each button carries a globally-unique `action_id`, exactly one element SHALL be removed. Non-actions blocks SHALL pass through unmodified.

#### Scenario: Exactly the clicked button is removed

- **WHEN** the rewrite runs for a clicked button whose `action_id` is `clack_merge_1`
- **THEN** the actions element with `action_id` `clack_merge_1` is removed
- **AND** every other block and button in the message is left byte-for-byte unchanged

### Requirement: Inbound blocks parsed via schema with a missing-blocks guard

The rewrite SHALL read the inbound message blocks through a zod schema rather than hand-rolled type guards or blind casts, following the repository convention for action payloads. When the inbound payload has no usable message blocks (absent or failing to parse), the handler SHALL leave the message untouched and SHALL NOT delete it, preserving the no-delete invariant on the edge case.

#### Scenario: Payload without message blocks is left untouched

- **WHEN** a button click arrives whose payload has no parseable message blocks
- **THEN** the handler does not delete the message
- **AND** the handler does not throw
- **AND** the post-click work the handler performs proceeds as normal
