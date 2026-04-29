## 1. Schema

- [x] 1.1 Verify whether `@slack/types` exports `MarkdownBlock` and `TableBlock` types in the project's installed version; if not, define narrow local types matching Slack's published shapes (cell variants: `raw_text`, `rich_text`). — `@slack/types@2.20.0` exports `MarkdownBlock`, `TableBlock`, `RawTextElement`, and `RichTextBlock`. Cell type per the d.ts: `(RichTextBlock | RawTextElement)[][]`.
- [x] 1.2 Add `markdownBlockSchema` to `src/slack/blockSchema.ts` as a `looseObject` with `type: "markdown"` and required non-empty `text: string`.
- [x] 1.3 Add table cell schemas to `src/slack/blockSchema.ts`: a string variant, a `raw_text` object variant, and a `rich_text` object variant (loose). Compose them as a discriminated/union cell schema.
- [x] 1.4 Add `tableBlockSchema` to `src/slack/blockSchema.ts` with required `rows: cell[][]` and optional `column_settings: { align, is_wrapped }[]`.
- [x] 1.5 Extend the `BlockSchema` discriminated union to include the two new schemas.
- [x] 1.6 Extend the `Block` TypeScript union and the `ALLOWED_BLOCK_TYPES` runtime list to include `"markdown"` and `"table"`.
- [x] 1.7 Add unit tests in the schema test file covering: valid markdown block parse; valid table block parse with bare-string cells; valid table block parse with rich_text cells; rejection of unknown block types still works (regression).

## 2. Preparer

- [x] 2.1 Add `prepareMarkdown` to `src/slack/blockPrepare.ts` as a passthrough (shallow copy preserving optional fields).
- [x] 2.2 Add `prepareTable` to `src/slack/blockPrepare.ts`: walk `rows[][]`, normalize bare-string cells into `{ type: "raw_text", text }`, and pass `raw_text` and `rich_text` cell objects through. Preserve `column_settings` and any other passthrough fields.
- [x] 2.3 Extend the `prepareBlocks` switch with `case "markdown"` and `case "table"`.
- [x] 2.4 Add unit tests in the preparer test file covering: markdown block passthrough is unchanged (no `convertMarkdownToSlack` is called); markdown block with `*bold*`-style markdown is NOT mrkdwn-converted; table cells of each shape are normalized correctly; `column_settings` survives.

## 3. Validator

- [x] 3.1 Add `validateMarkdown` to `src/slack/blockValidate.ts` (per-block: nothing to validate beyond the schema parse).
- [x] 3.2 Add a payload-scope check in `validateBlocks` that sums the `text` length across all `markdown` blocks and emits a single error if the cumulative total exceeds 12,000 characters. Error message names the cumulative count, the limit, and suggests reducing total markdown content.
- [x] 3.3 Add `validateTable` to `src/slack/blockValidate.ts` enforcing: max 100 rows; per-row max 20 cells; max 20 entries in `column_settings`; per-cell text ≤ 2,000 chars (computing length as the cell's text for `raw_text`/string, or the concatenated text of `rich_text` elements). Each violation produces a Claude-actionable error citing block index, row index, cell index where applicable, current measurement, and the limit.
- [x] 3.4 Add a payload-scope check in `validateBlocks` that rejects any `blocks` array containing more than one `table` block. Error message lists the indices of the offending blocks and points Claude at the markdown-table-inside-markdown-block alternative.
- [x] 3.5 Extend the `validateBlocks` switch with `case "markdown"` and `case "table"`.
- [x] 3.6 Add unit tests in the validator test file covering each new validation path: cumulative markdown over 12k; single oversize markdown block; tables with too many rows / cells / column_settings; oversize cell text; payload with two table blocks. Also include happy-path passing tests.

## 4. Prompt documentation

- [x] 4.1 Update `data/default_configuration/user/block-kit-formatting.md`: extend the curated-subset bullet list with `markdown` and `table`; add a "When to use which prose block" subsection (markdown for long-form/code/headers/lists, section for fields and short snippets); add a "Tabular data" subsection codifying the markdown-table-in-markdown-block default and the conditions to escalate to the structural `table` block; document the one-table-per-message constraint, the always-rendered-at-bottom behaviour, and the cell-shape options (string sugar, rich_text element trees).
- [x] 4.2 Update `data/default_configuration/user/submit-response.md`: change the one-line subset reference (currently `divider, header, section, context, image`) to include `markdown` and `table`; add a one-line pointer to the new tabular-data guidance in `block-kit-formatting.md`.

## 5. Verification

- [x] 5.1 Run `npx tsc --noEmit` and confirm clean.
- [x] 5.2 Run `npm test` and confirm all new and existing block-related tests pass. — 2,973 tests pass (was 2,952; +21 new).
- [x] 5.3 Run `openspec validate add-block-kit-markdown-and-table --strict` and confirm valid.
- [ ] 5.4 Manual smoke test: trigger Clack in a dev workspace with a query that yields a long-form answer (verify `markdown` block usage produces real headers/code highlighting) and one that yields tabular data (verify `table` block rendering or markdown-table fallback).
