## MODIFIED Requirements

### Requirement: Claude-Authored Block Kit Responses

The `submit_response` tool SHALL accept a `blocks: Block[]` field where `Block` is a curated subset of Slack Block Kit types. Claude authors the response structure directly by selecting block types appropriate to the content. The curated subset is: `divider`, `header`, `section` (with optional `fields`), `context`, `image`, `markdown`. Blocks outside this subset are rejected at the tool boundary. `actions` blocks SHALL NOT appear in the `blocks` array — action buttons are driven by the structured `actions: Action[]` field on `submit_response` and rendered by Clack into Slack `actions` blocks at delivery time. Tabular content SHALL NOT appear inside `blocks`; tables are authored via the top-level `table` parameter (see *Top-Level Table Parameter*).

#### Scenario: submit_response accepts a valid blocks array

- **WHEN** Claude calls `submit_response` with a `blocks` array containing one or more blocks of allowed types, each conforming to Slack's Block Kit schema
- **THEN** validation passes
- **AND** the blocks are prepared (markdown converted on section/context as before, markdown-block text passed through) and delivered via the deliver callback

#### Scenario: submit_response rejects a disallowed block type

- **WHEN** Claude calls `submit_response` with a block whose `type` is not in the curated subset (e.g., `input`, `rich_text`, `file`, `video`, `alert`, `card`)
- **THEN** the tool returns a validation error naming the disallowed type and listing the allowed types
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

## ADDED Requirements

### Requirement: Markdown Block Support

The `submit_response` tool SHALL accept blocks of `type: "markdown"` with a required `text` field containing GitHub-flavored markdown. The preparer SHALL pass `markdown` blocks through untouched — no `convertMarkdownToSlack` and no client-side splitting. The validator SHALL enforce a cumulative cap of 12,000 characters across the `text` of all `markdown` blocks in a single delivered payload, mirroring Slack's documented limit. Slack itself handles oversize markdown blocks by splitting them server-side into multiple blocks; Clack does not pre-split.

#### Scenario: markdown block accepted and passed through

- **WHEN** Claude calls `submit_response` with a `markdown` block whose `text` is well under 12,000 cumulative chars
- **THEN** the schema parse passes
- **AND** `prepareBlocks` returns the block unchanged (no markdown conversion, no splitting)
- **AND** validation passes
- **AND** the deliver callback receives the markdown block as authored

#### Scenario: cumulative markdown text exceeds 12,000 chars

- **GIVEN** the `blocks` array contains multiple `markdown` blocks whose `text` lengths sum to more than 12,000 characters
- **WHEN** the tool validates the blocks
- **THEN** the tool returns a validation error naming the cumulative character count and the 12,000-char limit
- **AND** the error suggests reducing total markdown content or splitting across multiple responses
- **AND** the deliver callback is not called

#### Scenario: a single markdown block exceeds 12,000 chars

- **WHEN** Claude submits one `markdown` block whose `text` alone exceeds 12,000 characters
- **THEN** the tool returns a validation error citing the cumulative cap (it is the same constraint, by definition the cumulative sum)
- **AND** the deliver callback is not called

#### Scenario: markdown block missing text

- **WHEN** Claude submits a `markdown` block with no `text` field, or `text: ""`
- **THEN** the schema parse rejects the block with an error identifying the missing/empty `text` field

### Requirement: Top-Level Table Parameter

The `submit_response` tool SHALL accept an optional top-level `table` parameter, sibling to `blocks`. When present, `table` is a single Slack `table` block with a required `rows` field — an array of row arrays of cells. Each cell SHALL be either (a) a bare string, (b) `{ type: "raw_text", text }`, or (c) `{ type: "rich_text", elements: [...] }`. The schema enforces "at most one table per message" structurally (single optional field). The preparer SHALL normalize bare-string cells into `{ type: "raw_text", text }` and pass the other forms through untouched. The validator SHALL enforce: at most 100 rows; at most 20 cells per row; at most 20 entries in the optional `column_settings` array; and, for string and `raw_text` cells, at most 2,000 characters of text. The per-cell text cap is NOT enforced for `rich_text` cells because computing rendered text length would require encoding Slack's rich_text element schema. At the Slack send boundary, the prepared `table` SHALL be appended to the `blocks` array passed to `chat.postMessage`. Slack itself renders the table at the bottom of the message.

#### Scenario: top-level table accepted with bare-string cells

- **WHEN** Claude calls `submit_response` with a `table` parameter whose rows contain bare-string cells
- **THEN** the schema parse passes
- **AND** `prepareTable` wraps each bare-string cell as `{ type: "raw_text", text: <string> }`
- **AND** validation passes
- **AND** the deliver callback receives the prepared blocks plus the prepared table appended at the end

#### Scenario: top-level table cell with rich_text elements passed through

- **WHEN** Claude calls `submit_response` with a `table` parameter containing a cell of shape `{ type: "rich_text", elements: [...] }`
- **THEN** the schema parse passes
- **AND** `prepareTable` does not modify the rich_text cell
- **AND** validation passes
- **AND** the deliver callback receives the rich_text cell as authored

#### Scenario: top-level table exceeds 100 rows

- **WHEN** the `table` parameter has more than 100 rows
- **THEN** the tool returns a validation error naming the row count and the 100-row limit
- **AND** the deliver callback is not called

#### Scenario: top-level table row exceeds 20 cells

- **WHEN** any row of the `table` parameter has more than 20 cells
- **THEN** the tool returns a validation error naming the row index, cell count, and the 20-cell limit
- **AND** the deliver callback is not called

#### Scenario: top-level table column_settings exceeds 20 entries

- **WHEN** the `table` parameter has a `column_settings` array with more than 20 items
- **THEN** the tool returns a validation error naming the count and the 20-item limit

#### Scenario: string or raw_text cell exceeds 2,000 chars

- **WHEN** a string or `raw_text` cell's text in the `table` parameter exceeds 2,000 characters
- **THEN** the tool returns a validation error naming the row index, cell index, current length, and the 2,000-char limit

#### Scenario: rich_text cell skips per-cell text cap

- **WHEN** a `rich_text` cell in the `table` parameter contains element-tree text that would exceed 2,000 characters when rendered
- **THEN** the tool does NOT raise a per-cell text-cap error (we don't measure rich_text element text — rendering correctness is enforced server-side)

#### Scenario: top-level table appended to blocks at delivery

- **GIVEN** Claude calls `submit_response` with a `blocks` array of N entries and a non-null `table` parameter
- **WHEN** the deliver callback posts the message via `chat.postMessage`
- **THEN** the outgoing `blocks` argument contains the N prepared content blocks followed by the prepared table block as the (N+1)th entry
- **AND** Slack renders the table at the bottom of the resulting message

#### Scenario: post_to action accepts a sibling table

- **WHEN** Claude includes a `post_to` action with a `blocks` array and a `table` parameter
- **THEN** the schema parse and validation apply the same rules as the top-level `submit_response.table`
- **AND** the per-button snapshot persists `blocks` and `table` together
- **AND** at delivery (auto-execute or button-click path), the prepared table is appended to the cross-posted `blocks` argument

#### Scenario: post_to without table delivers blocks only

- **WHEN** a `post_to` action omits the `table` parameter
- **THEN** the cross-posted message receives the `blocks` argument unchanged (no table appended)
- **AND** the snapshot stores no `table` field
