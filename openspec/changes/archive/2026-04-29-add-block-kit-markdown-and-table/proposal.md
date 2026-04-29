## Why

Clack's curated Block Kit subset (`divider`, `header`, `section`, `context`, `image`) covers prose answers but leaves two common Q&A shapes underserved: long-form responses with markdown features Slack's mrkdwn doesn't natively support (real headers, syntax-highlighted code blocks, task lists), and tabular data (lists of repos, sessions, PRs, comparisons) that today flatten into bullet lists or two-column `fields`. Slack's `markdown` and `table` blocks fix both, and the `markdown` block also lets us drop the markdown→mrkdwn conversion and 3000-char split for prose blocks (Slack handles both natively).

The `table` block has a structural quirk that makes it a poor fit as a member of the `blocks` array: Slack always renders it at the bottom of the message regardless of position in `blocks` (it is appended as an attachment), and the API rejects payloads with more than one table per message. Modeling it as one of seven peers in `blocks` leaks both quirks into Claude's authoring contract — no amount of prompt guidance reliably keeps the model from interleaving a table mid-response or staging two tables. We therefore expose `table` as a top-level optional **sibling** parameter on `submit_response` (and on the `post_to` action's payload), distinct from `blocks`. The schema enforces "at most one" trivially (single optional field), and the wire-level Slack call concatenates the table after `blocks` so the rendered output matches what Claude authored.

## What Changes

- Add `markdown` block to the curated subset accepted by `submit_response.blocks` and `post_to.blocks`.
- **Add `table` as a top-level optional parameter** on `submit_response` and on the `post_to` action — sibling of `blocks`, NOT a member of the `blocks` array.
- Extend `BlockSchema` (Zod) with `markdownBlockSchema` only. The `tableBlockSchema` is exported separately for the standalone parameter and is **not** a member of the `Block` discriminated union; `ALLOWED_BLOCK_TYPES` does not include `"table"`.
- Extend `prepareBlocks` with passthrough for `markdown`. Export `prepareTable` for the sibling parameter; do NOT add a `case "table"` to the `prepareBlocks` switch.
- Extend `validateBlocks` with the markdown-block cumulative-text cap (12,000 chars). Export `validateTable` for the sibling parameter; do NOT add a `case "table"` to the `validateBlocks` switch and do NOT include a multi-table payload-scope check (single optional field makes it unreachable).
- Thread the optional `table` through the delivery layer (`DeliverFn` opts, `ResponseSnapshot`, `submit_response` deps, `post_to` snapshot persistence). At the `chat.postMessage` boundary, prepare and append the table to the outgoing `blocks` array.
- Update `data/default_configuration/user/block-kit-formatting.md` to document `markdown` (block) and `table` (top-level parameter), including when to prefer each (markdown for prose; markdown-table-inside-markdown-block as the default tabular shape; the structural `table` parameter when alignment, wrap control, or rich cell elements are needed).
- Update `data/default_configuration/user/submit-response.md` to (a) include `markdown` in the curated-subset reference, (b) document the new top-level `table` parameter, (c) note that `post_to` carries an optional sibling `table` field.
- Add tests for schema parsing, preparer behavior, validator limits, and end-to-end delivery (top-level `table` is appended after `blocks` when the message is posted to Slack).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `clack-tool-response`: extends the curated Block Kit subset Claude may author inside `blocks` from 5 types (`divider`, `header`, `section`, `context`, `image`) to 6 (adds `markdown`); adds a top-level `table` parameter on `submit_response` and on the `post_to` action; defines preparer, validator, and delivery behavior for both new surfaces.

## Impact

- **Code:**
  - `src/slack/blockSchema.ts` — add `markdownBlockSchema` to the `Block` union and `ALLOWED_BLOCK_TYPES`. Add `tableBlockSchema` and table cell schemas as exported standalone schemas, NOT in the union.
  - `src/slack/blockPrepare.ts` — add `prepareMarkdown` (passthrough) to the `prepareBlocks` switch; export `prepareTable` for the standalone parameter.
  - `src/slack/blockValidate.ts` — add `validateMarkdown` (cumulative-text cap) to `validateBlocks`; export `validateTable` for the standalone parameter. No multi-table payload-scope check.
  - `src/tools/presentation/submitResponse.ts` — add `table?: AuthoredTableBlock` to the shared `messageContentFields` fragment so it flows into both the top-level schema and `postToActionSchema`. Validate the optional table at each call site. Persist into snapshots.
  - `src/tools/types.ts` — add optional `table` to `DeliverFn` opts and to `ResponseSnapshot`.
  - `src/slack/handlers/handlerResponse.ts` — `buildDeliverFn` appends the prepared `table` to the outgoing `blocks` argument of `chat.postMessage` when present.
  - `src/slack/handlers/dmActions.ts` — `postAnswerToChannel` reads `snapshot.table` and appends it to the outgoing `blocks` array.
  - `src/slack/blocks.ts` — `getStructuredAcceptedBlocks` / `getStructuredResponseBlocks` include the prepared table when present.
- **Prompts (instructions):**
  - `data/default_configuration/user/block-kit-formatting.md`
  - `data/default_configuration/user/submit-response.md`
- **Tests:** unit tests for schema, preparer, validator, and the delivery-layer concatenation in the corresponding `*.test.ts` files; updated `submitResponse.test.ts` and `dmActions.test.ts` to cover the new parameter shape.
- **No external API changes.** No migration. No dependency updates (`@slack/types@2.20.0` already exports `MarkdownBlock`, `TableBlock`, `RawTextElement`, and `RichTextBlock`).
- **Behavioural compatibility:** existing 5-block subset behaviour is unchanged. `markdown` is purely additive at the block level. `table`-as-block is removed before the change archives — the prior intermediate implementation (commit `a311e08`) is superseded by the redesign in this same change.
