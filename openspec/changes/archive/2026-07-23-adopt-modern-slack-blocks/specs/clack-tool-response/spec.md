# clack-tool-response — Delta

## MODIFIED Requirements

### Requirement: Top-Level Table Parameter

The `submit_response` tool SHALL accept an optional top-level `table` parameter, sibling to `blocks`. When present, `table` is a single authored table with a required `rows` field — an array of row arrays of cells. Each cell SHALL be either (a) a bare string, (b) `{ type: "raw_text", text }`, or (c) `{ type: "rich_text", elements: [...] }`. The table carries an optional `variant: "table" | "data_table"` field (default `"table"`) that selects the block emitted at delivery, and an optional `caption` used only by the `data_table` variant. The schema enforces "at most one table per message" structurally (single optional field). The preparer SHALL normalize bare-string cells into `{ type: "raw_text", text }` and pass the other forms through untouched. The validator SHALL enforce: a row cap of 100 for the default variant and 200 for `data_table`; at most 20 cells per row; at most 20 entries in the optional `column_settings` array; and, for string and `raw_text` cells, at most 2,000 characters of text. The per-cell text cap is NOT enforced for `rich_text` cells because computing rendered text length would require encoding Slack's rich_text element schema.

At the Slack send boundary the prepared table is rendered and appended to the `blocks` array passed to `chat.postMessage`. The **default variant** (`variant` absent or `"table"`) emits the legacy Slack `table` block with `column_settings` preserved — byte-for-byte as before this change. **`variant: "data_table"`** emits a Slack `data_table` block (interactive pagination and sortable columns): string/`raw_text` cells map 1:1, `rich_text` cells pass through, a default `page_size` constant is applied, and the `caption` (authored, or a default label) is set. Slack's `data_table` has no per-column alignment, so any authored `column_settings` is dropped under that variant. When the estimated serialized size of the converted `data_table` exceeds Slack's 20,000-character aggregate cap, delivery SHALL fall back to the legacy `table` block for that message (with a log line) instead of failing. The same rendering applies to `post_to` sibling tables.

#### Scenario: top-level table accepted with bare-string cells

- **WHEN** Claude calls `submit_response` with a `table` parameter whose rows contain bare-string cells
- **THEN** the schema parse passes
- **AND** `prepareTable` wraps each bare-string cell as `{ type: "raw_text", text: <string> }`
- **AND** validation passes
- **AND** the deliver callback receives the prepared blocks plus the rendered table appended at the end

#### Scenario: top-level table cell with rich_text elements passed through

- **WHEN** Claude calls `submit_response` with a `table` parameter containing a cell of shape `{ type: "rich_text", elements: [...] }`
- **THEN** the schema parse passes
- **AND** `prepareTable` does not modify the rich_text cell
- **AND** validation passes
- **AND** the rendered table carries the rich_text cell as authored

#### Scenario: default variant renders a legacy table block

- **GIVEN** a `table` parameter with `variant` absent or `"table"`
- **WHEN** it reaches the Slack send boundary
- **THEN** the outgoing `blocks` argument contains a block of `type: "table"` with `column_settings` preserved

#### Scenario: data_table variant renders a data_table block

- **GIVEN** a `table` parameter with `variant: "data_table"`
- **WHEN** it reaches the Slack send boundary
- **THEN** the outgoing `blocks` argument contains a block of `type: "data_table"` (not `type: "table"`)
- **AND** string/`raw_text` cells appear as `data_table` raw-text cells, `rich_text` cells pass through unchanged
- **AND** any authored `column_settings` is dropped (Slack's `data_table` has no per-column alignment)
- **AND** the block carries the default `page_size` constant and a `caption`

#### Scenario: default variant enforces the 100-row cap

- **WHEN** a default-variant `table` parameter has more than 100 rows
- **THEN** the tool returns a validation error naming the row count and the 100-row limit
- **AND** the deliver callback is not called

#### Scenario: data_table variant enforces the 200-row cap

- **WHEN** a `variant: "data_table"` `table` parameter has more than 200 rows
- **THEN** the tool returns a validation error naming the row count and the 200-row limit
- **AND** the deliver callback is not called

#### Scenario: oversized data_table falls back to legacy rendering

- **GIVEN** a `variant: "data_table"` table
- **WHEN** the converted `data_table` payload's estimated serialized size exceeds 20,000 characters
- **THEN** delivery renders the legacy `table` block for that message instead
- **AND** a log line records the fallback
- **AND** the message posts successfully

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
- **THEN** the outgoing `blocks` argument contains the N prepared content blocks followed by the rendered table block as the last entry

#### Scenario: post_to action accepts a sibling table

- **WHEN** Claude includes a `post_to` action with a `blocks` array and a `table` parameter
- **THEN** the schema parse and validation apply the same rules as the top-level `submit_response.table` (including the variant-dependent row cap)
- **AND** the per-button snapshot persists `blocks` and `table` together
- **AND** at delivery (auto-execute or button-click path), the rendered table block (legacy or `data_table` per its `variant`) is appended to the cross-posted `blocks` argument

#### Scenario: post_to without table delivers blocks only

- **WHEN** a `post_to` action omits the `table` parameter
- **THEN** the cross-posted message receives the `blocks` argument unchanged (no table appended)
- **AND** the snapshot stores no `table` field

## ADDED Requirements

### Requirement: Top-Level Chart Parameter

The `submit_response` tool and every `post_to` action SHALL accept an optional top-level `chart` parameter, sibling to `blocks` and `table`. The parameter is a curated payload: `{ chart_type: "pie" | "bar" | "area" | "line", title?, segments?, series?, axis_config? }`. A `validateChart` function (not zod refinements, to preserve JSON-Schema serializability) SHALL enforce: `pie` requires `segments` (1–12 entries) and forbids `series`; `bar`/`area`/`line` require `series` (1–12, each with 1–20 data points) and forbid `segments`; labels at most 20 characters; `title` at most 50 characters. At delivery, the chart renders as a Slack `data_visualization` block appended after the prepared content blocks and before the table block when both are present. The single optional field structurally enforces at most one chart per message.

#### Scenario: valid pie chart accepted and rendered

- **WHEN** Claude calls `submit_response` with `chart: { chart_type: "pie", segments: [...] }` containing 1–12 labeled segments
- **THEN** validation passes
- **AND** the outgoing `blocks` argument contains a `data_visualization` block built from the payload, positioned after the content blocks and before any table block

#### Scenario: pie chart with series rejected

- **WHEN** the `chart` parameter has `chart_type: "pie"` and a `series` field
- **THEN** the tool returns a validation error stating that `pie` takes `segments`, not `series`
- **AND** the deliver callback is not called

#### Scenario: series chart bounds enforced

- **WHEN** a `bar`, `area`, or `line` chart has more than 12 series, or any series has more than 20 data points
- **THEN** the tool returns a validation error naming the offending count and the limit

#### Scenario: label and title caps enforced

- **WHEN** any segment/series label exceeds 20 characters or the `title` exceeds 50 characters
- **THEN** the tool returns a validation error naming the offending field, its length, and the cap

#### Scenario: chart appended before table when both present

- **WHEN** Claude calls `submit_response` with both a `chart` and a `table` parameter
- **THEN** the outgoing `blocks` argument places the `data_visualization` block after the content blocks and before the table block

#### Scenario: post_to action carries a chart

- **WHEN** Claude includes a `post_to` action with a valid `chart` parameter
- **THEN** validation applies the same rules as the top-level `submit_response.chart`
- **AND** the per-button snapshot persists the chart alongside `blocks` and `table`
- **AND** at delivery the `data_visualization` block is appended to the cross-posted message
