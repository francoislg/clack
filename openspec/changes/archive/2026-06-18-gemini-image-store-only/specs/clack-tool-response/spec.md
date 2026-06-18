## ADDED Requirements

### Requirement: Image Block Source — Public URL or Slack File Reference

A curated `image` block SHALL carry a non-empty `alt_text` and **exactly one** image source: either `image_url` (a publicly fetchable URL that Slack's image proxy retrieves) or `slack_file` (a reference to a Slack-owned file, rendered without a public URL). `slack_file` SHALL carry **exactly one** of `id` (the Slack file id) or `url` (the file's `url_private` or `permalink`). Supplying both `image_url` and `slack_file`, or both `id` and `url` inside `slack_file`, SHALL be rejected at the tool boundary with an actionable error; supplying neither source SHALL also be rejected. The `slack_file` source lets Claude render a private/unshared Slack file — for example the handle returned by `generate_image` — inline in `submit_response`, `post_to`, and `deliver_to` messages.

#### Scenario: image block with a public image_url accepted

- **WHEN** an `image` block carries a non-empty `image_url` and `alt_text` and no `slack_file`
- **THEN** validation passes

#### Scenario: image block with slack_file id accepted

- **WHEN** an `image` block carries `slack_file: { id }` (non-empty) and `alt_text` and no `image_url`
- **THEN** validation passes

#### Scenario: image block with slack_file url accepted

- **WHEN** an `image` block carries `slack_file: { url }` (a `url_private`/`permalink`) and `alt_text` and no `image_url`
- **THEN** validation passes

#### Scenario: image block with both image_url and slack_file rejected

- **WHEN** an `image` block carries both `image_url` and `slack_file`
- **THEN** the tool returns a validation error naming the block index and stating that exactly one of `image_url` or `slack_file` is allowed

#### Scenario: image block with neither image_url nor slack_file rejected

- **WHEN** an `image` block carries neither `image_url` nor `slack_file`
- **THEN** the tool returns a validation error naming the block index and stating that the block needs either `image_url` or `slack_file`

#### Scenario: slack_file with both id and url rejected

- **WHEN** an `image` block's `slack_file` carries both `id` and `url`
- **THEN** the tool returns a validation error naming the block index and stating that `slack_file` needs exactly one of `id` or `url`

#### Scenario: slack_file with neither id nor url rejected

- **WHEN** an `image` block's `slack_file` carries neither `id` nor `url`
- **THEN** the tool returns a validation error naming the block index and stating that `slack_file` needs exactly one of `id` or `url`

## MODIFIED Requirements

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

#### Scenario: image block missing alt_text

- **WHEN** an `image` block has an empty or missing `alt_text`
- **THEN** the tool returns a validation error naming the `alt_text` field
- **AND** image-source validation (`image_url` vs `slack_file`) is governed by the *Image Block Source — Public URL or Slack File Reference* requirement

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
