## Why

Clack's curated Block Kit subset (`divider`, `header`, `section`, `context`, `image`) covers prose answers but leaves two common Q&A shapes underserved: long-form responses with markdown features Slack's mrkdwn doesn't natively support (real headers, syntax-highlighted code blocks, task lists), and tabular data (lists of repos, sessions, PRs, comparisons) that today flatten into bullet lists or two-column `fields`. Slack's `markdown` and `table` blocks fix both, and the `markdown` block also lets us drop the markdown→mrkdwn conversion and 3000-char split for prose blocks (Slack handles both natively).

## What Changes

- Add `markdown` block to the curated subset accepted by `submit_response` and `post_to`.
- Add `table` block to the curated subset.
- Extend `BlockSchema` (Zod) with both block types.
- Extend `prepareBlocks` with passthrough for `markdown` (no conversion, no splitting — Slack handles cumulative-overflow split itself) and cell normalization for `table` (string cells → `raw_text`, `rich_text` cells passed through).
- Extend `validateBlocks` with markdown-block cumulative-text cap (12,000 chars across all `markdown` blocks per payload) and table-block limits (max 1 per message, max 100 rows, max 20 cells/row, max 20 `column_settings`).
- Update `data/default_configuration/user/block-kit-formatting.md` to document both new types, including when to prefer each (markdown for prose; markdown-table-inside-markdown-block as the default tabular shape; structural `table` block when alignment, wrap control, or rich cell elements are needed).
- Update `data/default_configuration/user/submit-response.md`'s one-line subset reference to include `markdown` and `table`.
- Add tests for schema parsing, preparer behavior, and validator limits for both new block types.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `clack-tool-response`: extends the curated Block Kit subset Claude may author from 5 types (`divider`, `header`, `section`, `context`, `image`) to 7 (adds `markdown`, `table`); adds preparer and validator behavior specific to the new types.

## Impact

- **Code:**
  - `src/slack/blockSchema.ts` — add `markdownBlockSchema`, `tableBlockSchema`, table-cell schemas; extend `Block` union and `ALLOWED_BLOCK_TYPES`.
  - `src/slack/blockPrepare.ts` — add `prepareMarkdown` (passthrough) and `prepareTable` (cell normalization); extend `prepareBlocks` switch.
  - `src/slack/blockValidate.ts` — add `validateMarkdown` (cumulative-text cap), `validateTable` (per-table limits, plus a payload-scope check for >1 table); extend `validateBlocks` switch.
- **Prompts (instructions):**
  - `data/default_configuration/user/block-kit-formatting.md`
  - `data/default_configuration/user/submit-response.md`
- **Tests:** unit tests for schema, preparer, and validator additions in the corresponding `*.test.ts` files (or co-located new files following the small-files-with-tests convention).
- **No external API changes.** No migration. No dependency updates (`@slack/types` already exports `MarkdownBlock` and `TableBlock` types; verify version at design time).
- **Behavioural compatibility:** existing 5-block subset behaviour is unchanged. The change is purely additive at the tool boundary; older Claude sessions that never emit the new types are unaffected.
