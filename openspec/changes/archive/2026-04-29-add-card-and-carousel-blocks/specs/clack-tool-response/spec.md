## MODIFIED Requirements

### Requirement: Claude-Authored Block Kit Responses

The `submit_response` tool SHALL accept a `blocks: Block[]` field where `Block` is a curated subset of Slack Block Kit types. Claude authors the response structure directly by selecting block types appropriate to the content. The curated subset is: `divider`, `header`, `section` (with optional `fields`), `context`, `image`, `markdown`, `card`, `carousel`. Blocks outside this subset are rejected at the tool boundary. `actions` blocks SHALL NOT appear in the `blocks` array — action buttons are driven by the structured `actions: Action[]` field on `submit_response` and rendered by Clack into Slack `actions` blocks at delivery time. Tabular content SHALL NOT appear inside `blocks`; tables are authored via the top-level `table` parameter (see *Top-Level Table Parameter*). A `card` block SHALL NOT carry an inline `actions` field in v1 — card-level interactive buttons are deferred; the top-level `actions: Action[]` field is the only path to interactive buttons.

#### Scenario: submit_response accepts a valid blocks array

- **WHEN** Claude calls `submit_response` with a `blocks` array containing one or more blocks of allowed types, each conforming to Slack's Block Kit schema
- **THEN** validation passes
- **AND** the blocks are prepared (markdown converted on section/context as before, markdown-block text passed through, card text fields converted) and delivered via the deliver callback

#### Scenario: submit_response rejects a disallowed block type

- **WHEN** Claude calls `submit_response` with a block whose `type` is not in the curated subset (e.g., `input`, `rich_text`, `file`, `video`, `alert`)
- **THEN** the tool returns a validation error naming the disallowed type and listing the allowed types (including `card` and `carousel`)
- **AND** the deliver callback is not called

#### Scenario: submit_response rejects a `table` block inside the blocks array

- **WHEN** Claude calls `submit_response` with a block of `type: "table"` inside the `blocks` array
- **THEN** the schema parse rejects the block as a disallowed type
- **AND** the error message identifies the offending block index and the disallowed type
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

#### Scenario: submit_response accepts a card block

- **WHEN** Claude calls `submit_response` with a `card` block carrying at least one of `hero_image`, `title`, `actions`, or `body` (and any combination of optional `icon`, `subtitle`)
- **THEN** validation passes
- **AND** the card is prepared (mrkdwn-conversion runs on `title`, `subtitle`, `body`) and delivered via the deliver callback

#### Scenario: submit_response accepts a carousel block

- **WHEN** Claude calls `submit_response` with a `carousel` block whose `elements` array contains 1 to 10 valid card blocks
- **THEN** validation passes
- **AND** the carousel and each child card are prepared (mrkdwn-conversion runs on each child card's text fields) and delivered via the deliver callback

#### Scenario: submit_response rejects a card with an inline `actions` field in v1

- **WHEN** Claude calls `submit_response` with a `card` block that has an `actions` field
- **THEN** the tool returns a validation error explaining that card-level actions are not supported in v1
- **AND** the error points Claude at the top-level `actions: Action[]` field on `submit_response` as the correct path
- **AND** the deliver callback is not called

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

#### Scenario: card title exceeds 150 chars

- **WHEN** a `card` block's `title` exceeds 150 characters
- **THEN** the tool returns a validation error naming the block index, field (`title`), current length, and the 150-char limit
- **AND** does not call the deliver callback

#### Scenario: card subtitle exceeds 150 chars

- **WHEN** a `card` block's `subtitle` exceeds 150 characters
- **THEN** the tool returns a validation error naming the block index, field (`subtitle`), current length, and the 150-char limit

#### Scenario: card body exceeds 200 chars

- **WHEN** a `card` block's `body` exceeds 200 characters
- **THEN** the tool returns a validation error naming the block index, field (`body`), current length, and the 200-char limit

#### Scenario: card has none of hero_image / title / actions / body

- **WHEN** a `card` block omits all of `hero_image`, `title`, `actions`, and `body`
- **THEN** the tool returns a validation error naming the block index and explaining that at least one of `hero_image`, `title`, `actions`, or `body` is required (per Slack's documented Card schema)

#### Scenario: card hero_image is missing image_url or alt_text

- **WHEN** a `card` block's `hero_image` object is missing `image_url` or `alt_text`
- **THEN** the tool returns a validation error naming the block index and the missing field

#### Scenario: card icon is missing image_url or alt_text

- **WHEN** a `card` block's `icon` object is missing `image_url` or `alt_text`
- **THEN** the tool returns a validation error naming the block index and the missing field

#### Scenario: carousel has zero elements

- **WHEN** a `carousel` block has an `elements` array of length 0
- **THEN** the tool returns a validation error naming the block index, element count, and the 1–10 range

#### Scenario: carousel has more than 10 elements

- **WHEN** a `carousel` block has an `elements` array of length greater than 10
- **THEN** the tool returns a validation error naming the block index, element count, and the 10-element upper bound

#### Scenario: carousel element is not a card

- **WHEN** any element of a `carousel` block has a `type` other than `"card"`
- **THEN** the tool returns a validation error naming the block index, element index, the offending type, and explaining that carousel elements must be card blocks

#### Scenario: carousel child card violates a card limit

- **WHEN** any card inside a `carousel` block's `elements` violates a card-level limit (e.g., title > 150 chars, body > 200 chars, or none of hero_image/title/actions/body)
- **THEN** the tool returns a validation error naming the carousel block index, the element index, the failing field path inside the card, current length (where applicable), and the limit
- **AND** does not call the deliver callback

#### Scenario: total block count exceeds 50

- **GIVEN** validation runs AFTER `prepareBlocks` has split oversize sections AND AFTER action-button blocks have been appended to the content blocks
- **WHEN** the resulting total block count exceeds 50
- **THEN** the tool returns a validation error naming the total count, the component parts (content blocks, split-added blocks, action-button blocks), and the 50-block limit

#### Scenario: action-button blocks contribute to the 50-block budget

- **GIVEN** Claude submits 48 content blocks plus 10 actions that render as 2 action-button blocks (Slack groups buttons in rows of 5)
- **WHEN** validation runs after action appending
- **THEN** the total is 50 (48 + 2) — validation passes
- **AND** a submission of 49 content blocks plus the same 10 actions (total 51) fails validation
