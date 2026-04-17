## ADDED Requirements

### Requirement: Claude-Authored Block Kit Responses

The `submit_response` tool SHALL accept a `blocks: Block[]` field where `Block` is a curated subset of Slack Block Kit types. Claude authors the response structure directly by selecting block types appropriate to the content. The curated subset is: `divider`, `header`, `section` (with optional `fields`), `context`, `image`. Blocks outside this subset are rejected at the tool boundary. `actions` blocks SHALL NOT appear in the `blocks` array — action buttons are driven by the structured `actions: Action[]` field on `submit_response` and rendered by Clack into Slack `actions` blocks at delivery time.

#### Scenario: submit_response accepts a valid blocks array

- **WHEN** Claude calls `submit_response` with a `blocks` array containing one or more blocks of allowed types, each conforming to Slack's Block Kit schema
- **THEN** validation passes
- **AND** the blocks are prepared (markdown converted, oversize text split) and delivered via the deliver callback

#### Scenario: submit_response rejects a disallowed block type

- **WHEN** Claude calls `submit_response` with a block whose `type` is not in the curated subset (e.g., `input`, `rich_text`, `file`, `video`)
- **THEN** the tool returns a validation error naming the disallowed type and listing the allowed types
- **AND** the deliver callback is not called

#### Scenario: submit_response rejects an `actions` block in the blocks array

- **WHEN** Claude calls `submit_response` with a block of `type: "actions"` inside the `blocks` array
- **THEN** the tool returns a validation error explaining that action buttons are driven by the structured `actions` field on `submit_response`, not authored as `actions` blocks in `blocks`
- **AND** the error points Claude at the structured `actions: Action[]` field as the correct path
- **AND** the deliver callback is not called

#### Scenario: submit_response rejects an empty blocks array

- **WHEN** Claude calls `submit_response` with `blocks: []` without `skip_response: true`
- **THEN** the tool returns a validation error requiring at least one block

#### Scenario: submit_response with skip_response omits blocks entirely

- **WHEN** Claude calls `submit_response` with `skip_response: true` and no `blocks` field (or an empty array)
- **THEN** the tool accepts the call and records a skipped response
- **AND** the `blocks` field is not required for the skip path

### Requirement: Centralized Block Validation With Friendly Errors

The `submit_response` tool SHALL validate every block against per-type Slack Block Kit limits before delivery. Validation errors SHALL identify the failing field, current measurement, and applicable limit in a form Claude can act on to correct and retry.

#### Scenario: header text exceeds 150 chars

- **WHEN** a `header` block's `text.text` exceeds 150 characters
- **THEN** the tool returns a validation error naming the block index, field (`text.text`), current length, and the 150-char limit
- **AND** does not call the deliver callback

#### Scenario: context block has too many elements

- **WHEN** a `context` block has more than 10 elements
- **THEN** the tool returns a validation error naming the block index, element count, and the 10-element limit

#### Scenario: context element text exceeds 75 chars

- **WHEN** a `context` element's `text` exceeds 75 characters
- **THEN** the tool returns a validation error naming the block index, element index, current length, and the 75-char limit

#### Scenario: section text is split by prepareBlocks before validation

- **GIVEN** Claude submits a `section` block whose `text.text` exceeds 3000 characters
- **WHEN** the tool processes the blocks
- **THEN** `prepareBlocks` splits the oversize text into multiple section blocks, each ≤ 3000 characters, before validation
- **AND** validation passes on the split output
- **AND** the deliver callback receives the multi-block result

#### Scenario: section text cannot be split (e.g., unbreakable single run)

- **WHEN** `prepareBlocks` cannot split a `section` block's `text.text` below the 3000-char limit (e.g., a single unbroken token exceeds the limit)
- **THEN** the tool returns a validation error naming the block index, current length, and the 3000-char limit

#### Scenario: section fields outside 2–10 range

- **WHEN** a `section` block has `fields` with fewer than 2 or more than 10 items
- **THEN** the tool returns a validation error naming the count and the 2–10 range

#### Scenario: section field text exceeds 2000 chars

- **WHEN** any element in a `section` block's `fields` exceeds 2000 characters
- **THEN** the tool returns a validation error naming the block index, field index, current length, and the 2000-char limit

#### Scenario: image block missing alt_text or image_url

- **WHEN** an `image` block has an empty or missing `alt_text` or `image_url`
- **THEN** the tool returns a validation error naming the missing field

#### Scenario: total block count exceeds 50

- **GIVEN** validation runs AFTER `prepareBlocks` has split oversize sections AND AFTER action-button blocks have been appended to the content blocks
- **WHEN** the resulting total block count exceeds 50
- **THEN** the tool returns a validation error naming the total count, the component parts (content blocks, split-added blocks, action-button blocks), and the 50-block limit

#### Scenario: action-button blocks contribute to the 50-block budget

- **GIVEN** Claude submits 48 content blocks plus 10 actions that render as 2 action-button blocks (Slack groups buttons in rows of 5)
- **WHEN** validation runs after action appending
- **THEN** the total is 50 (48 + 2) — validation passes
- **AND** a submission of 49 content blocks plus the same 10 actions (total 51) fails validation

### Requirement: Message Preamble Renders Above Blocks

The `message` conversational-preamble field on `submit_response` SHALL, when provided, render as a prepended section block ABOVE the `blocks` array in the delivered Slack message. The preamble is not included in shareable content (`post_to` actions) — only in the displayed response. Reactions added via the `reactions` field apply to the posted message as a whole, unchanged by the presence of `message` or the block count.

#### Scenario: submit_response with both message and blocks

- **WHEN** Claude calls `submit_response` with `message: "Here's the update you asked for."` and a non-empty `blocks` array
- **THEN** the delivered Slack message contains a section block carrying the message text first
- **AND** the authored `blocks` array follows in order
- **AND** the total block count (message prepend + authored blocks + appended action blocks) is subject to the 50-block validation limit

#### Scenario: submit_response with blocks but no message

- **WHEN** Claude calls `submit_response` with `blocks` and no `message`
- **THEN** the delivered message contains the authored `blocks` only (plus any appended action blocks)
- **AND** no synthetic preamble is prepended

#### Scenario: message is excluded from post_to content

- **GIVEN** Claude submits a response with `message` set and a `post_to` action
- **WHEN** the user clicks the `post_to` button
- **THEN** only the `post_to.blocks` payload is posted to the target thread
- **AND** the `message` preamble is NOT included in the shared content

### Requirement: Reactions Applied To Block-Based Responses

The `reactions` field on `submit_response` SHALL continue to apply to the posted Slack message after delivery, regardless of block structure. Reactions target the message `ts` returned by the delivery, not individual blocks.

#### Scenario: reactions attached to a block-based response

- **WHEN** Claude calls `submit_response` with `blocks` and `reactions: ["white_check_mark", "thumbsup"]`
- **AND** delivery succeeds
- **THEN** each emoji is added as a reaction on the posted message via `reactions.add`
- **AND** reactions target the message `ts`, not any specific block

#### Scenario: invalid reactions are silently ignored

- **WHEN** a reaction name in the array is invalid or does not exist in the workspace
- **THEN** the system logs a warning
- **AND** other valid reactions are still applied
- **AND** the overall response delivery is NOT affected

### Requirement: Optional Slack Block Kit Fields Are Preserved

The block validator SHALL preserve optional Slack Block Kit fields on allowed block types (e.g., `block_id` for uniqueness/targeting, `confirm` dialogs on buttons, `accessibility_label` on elements) rather than stripping or rejecting them. The curated-type allowlist constrains which *block types* are accepted; it does not constrain which *fields* a block carries within an allowed type. This keeps the system aligned with Decision 2 (authentic Slack Block Kit) so Claude can use Block Kit features without Clack becoming a gatekeeper on every field Slack ships.

#### Scenario: section block with block_id is preserved

- **WHEN** Claude submits a `section` block that includes a `block_id: "intro_section"` field
- **THEN** validation passes
- **AND** the prepared output retains the `block_id` field verbatim
- **AND** the Slack API call includes the `block_id` on the posted block

#### Scenario: button with confirm dialog is preserved

- **WHEN** Claude submits an `actions` block whose button includes a `confirm: { title, text, confirm, deny }` Slack Block Kit confirmation dialog
- **THEN** validation passes
- **AND** the `confirm` payload is delivered on the button unchanged

#### Scenario: unknown block type is still rejected

- **GIVEN** the passthrough behavior for optional fields
- **WHEN** Claude submits a block whose `type` is outside the curated subset (e.g., `input`, `rich_text`, `file`, `video`)
- **THEN** validation still rejects the block, as defined by the "Claude-Authored Block Kit Responses" requirement
- **AND** passthrough applies only to optional fields *within* allowed block types, never to disallowed block types themselves

#### Scenario: prepareBlocks does not recurse into passthrough fields

- **GIVEN** a block carries a passthrough optional field whose value happens to contain text resembling internal markdown (e.g., a `block_id: "**bold**"` that Claude chose)
- **WHEN** `prepareBlocks` runs
- **THEN** the passthrough field value is NOT transformed by `convertMarkdownToSlack`
- **AND** only text on schema-known fields (`section.text.text`, `header.text.text`, `context.elements[].text`) is converted
- **AND** the passthrough field reaches Slack byte-identical to what Claude authored

### Requirement: post_to Actions Carry Blocks

The `post_to` action SHALL carry a `blocks: Block[]` payload representing the shareable response content. The legacy `content: string` field is removed. When the user clicks the `post_to` button, the stored blocks are prepared and posted via `chat.postMessage` with the blocks attached.

#### Scenario: post_to action with blocks is accepted

- **WHEN** Claude includes a `post_to` action with a valid `blocks` array
- **THEN** the tool validates the blocks using the same rules as the response body
- **AND** persists the blocks to the snapshot store under the action's snapshot ID

#### Scenario: post_to action with invalid blocks is rejected

- **WHEN** Claude includes a `post_to` action whose blocks fail validation
- **THEN** the tool returns a validation error identifying the action index and the block violation
- **AND** does not deliver the primary response

#### Scenario: post_to button click posts persisted blocks

- **GIVEN** a `post_to` action snapshot persisted with `{blocks}` at a snapshot ID
- **WHEN** the user clicks the button
- **THEN** the handler loads the snapshot, calls `prepareBlocks`, and posts the result via `chat.postMessage` with the `blocks` attached to the target channel and thread

#### Scenario: post_to button click with unparseable snapshot surfaces an expired error

- **GIVEN** a `post_to` action snapshot in the legacy `{text, sections}` shape (e.g., created before this change)
- **WHEN** the user clicks the button
- **THEN** the handler surfaces a friendly "link expired" error to the user rather than attempting delivery

### Requirement: Centralized Block Handling Across Outbound Surfaces

All Claude-authored outbound surfaces SHALL consume the central `src/slack/blocks.ts` module for block schema, validation, and preparation. No outbound surface SHALL implement its own block validation or markdown conversion.

#### Scenario: submit_response uses the central module

- **WHEN** `submit_response` processes a `blocks` array
- **THEN** it calls `validateBlocks` from `src/slack/blocks.ts` for validation
- **AND** calls `prepareBlocks` from the same module for markdown conversion and text splitting before delivery

#### Scenario: post_to handler uses the central module

- **WHEN** the `post_to` button handler prepares a persisted blocks payload for posting
- **THEN** it calls `prepareBlocks` from `src/slack/blocks.ts` rather than any local preparation logic

#### Scenario: plugin SDK scheduled-message delivery uses the central module

- **WHEN** a scheduled message is delivered via the plugin SDK path
- **THEN** the delivery code calls `validateBlocks` and `prepareBlocks` from `src/slack/blocks.ts` before posting

## REMOVED Requirements

### Requirement: Sections-Based Response Body

**Reason:** Replaced by `blocks: Block[]`. Clean cutover — no dual-mode coexistence. The `message` conversational-preamble field is retained as a plain string.

**Migration:** All instruction files referencing `sections` are rewritten to reference `blocks`. All callers are updated in the same change. No backwards compatibility.

### Requirement: post_to content String

**Reason:** Replaced by `post_to.blocks: Block[]`. Action snapshot persistence format changes. Pre-deploy snapshots surface as "link expired" errors.

**Migration:** Code call sites updated in the same change. In-flight snapshots are dropped on deserialize failure (ephemeral, user can re-request).
