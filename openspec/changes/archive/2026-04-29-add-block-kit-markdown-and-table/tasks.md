## 1. Schema — markdown block

- [x] 1.1 Verify whether `@slack/types` exports `MarkdownBlock` and `TableBlock` types in the project's installed version; if not, define narrow local types matching Slack's published shapes (cell variants: `raw_text`, `rich_text`). — `@slack/types@2.20.0` exports `MarkdownBlock`, `TableBlock`, `RawTextElement`, and `RichTextBlock`. Cell type per the d.ts: `(RichTextBlock | RawTextElement)[][]`.
- [x] 1.2 Add `markdownBlockSchema` to `src/slack/blockSchema.ts` as a `looseObject` with `type: "markdown"` and required non-empty `text: string`.
- [x] 1.5a Extend the `BlockSchema` discriminated union to include `markdownBlockSchema`.
- [x] 1.6a Extend the `Block` TypeScript union and the `ALLOWED_BLOCK_TYPES` runtime list to include `"markdown"`.
- [x] 1.7a Confirm unit tests in the schema test file cover: valid markdown block parse; rejection of unknown block types still works (regression).

## 2. Schema — standalone `table` parameter

- [x] 2.1 Add table cell schemas to `src/slack/blockSchema.ts`: a string variant, a `raw_text` object variant, and a `rich_text` object variant (loose). Compose them as a discriminated/union cell schema.
- [x] 2.2 Add `tableBlockSchema` to `src/slack/blockSchema.ts` with required `rows: cell[][]` and optional `column_settings: { align, is_wrapped }[]`.
- [x] 2.3 **Remove** `tableBlockSchema` from the `BlockSchema` discriminated union.
- [x] 2.4 **Remove** `"table"` from the `Block` TypeScript union and from `ALLOWED_BLOCK_TYPES`.
- [x] 2.5 Export `tableBlockSchema`, `AuthoredTableBlock`, `AuthoredTableCell`, `AuthoredRichTextCell`, and related types for use by the standalone parameter.
- [x] 2.6 Add a unit test in `src/slack/blockSchema.test.ts` asserting that `BlockSchema.parse({ type: "table", ... })` fails as a disallowed type.
- [x] 2.7 Migrate existing table-shape parse tests to target `tableBlockSchema` directly (valid bare-string cells; valid rich_text cells; missing `rows`; empty `rows`).

## 3. Preparer

- [x] 3.1 Add `prepareMarkdown` to `src/slack/blockPrepare.ts` as a passthrough (shallow copy preserving optional fields).
- [x] 3.2 Add `prepareTable` to `src/slack/blockPrepare.ts`: walk `rows[][]`, normalize bare-string cells into `{ type: "raw_text", text }`, and pass `raw_text` and `rich_text` cell objects through. Preserve `column_settings` and any other passthrough fields.
- [x] 3.3a Extend the `prepareBlocks` switch with `case "markdown"`.
- [x] 3.3b **Remove** the `case "table"` branch from the `prepareBlocks` switch.
- [x] 3.3c Export `prepareTable` from `src/slack/blockPrepare.ts` for direct use on the standalone parameter.
- [x] 3.4 Update preparer tests: keep markdown passthrough coverage; migrate table-cell-normalization tests to call `prepareTable` directly instead of going through `prepareBlocks`.

## 4. Validator

- [x] 4.1 Add `validateMarkdown` to `src/slack/blockValidate.ts` (per-block: nothing to validate beyond the schema parse).
- [x] 4.2 Add a payload-scope check in `validateBlocks` that sums the `text` length across all `markdown` blocks and emits a single error if the cumulative total exceeds 12,000 characters.
- [x] 4.3 Add `validateTable` to `src/slack/blockValidate.ts` enforcing: max 100 rows; per-row max 20 cells; max 20 entries in `column_settings`; per-cell text ≤ 2,000 chars (computing length as the cell's text for `raw_text`/string; `rich_text` cells skip the cap). Each violation produces a Claude-actionable error citing block index, row index, cell index where applicable, current measurement, and the limit.
- [x] 4.4 **Remove** the multi-table payload-scope check from `validateBlocks` (no longer reachable; the schema admits at most one table via the optional sibling field).
- [x] 4.5 **Remove** the `case "table"` branch from the `validateBlocks` switch.
- [x] 4.6 Export `validateTable` from `src/slack/blockValidate.ts` with a `pathPrefix: string` parameter for namespacing field paths (e.g., `"table"` vs `"actions[2].table"`).
- [x] 4.7 Update validator tests: keep markdown-cumulative-cap tests; drop multi-table-guard tests; replace table-in-blocks tests with direct `validateTable` calls; add a path-prefix namespacing test.

## 5. Top-level `table` parameter wiring

- [x] 5.1 Add an optional `table?: AuthoredTableBlock` field to the shared `messageContentFields` fragment in `src/tools/presentation/submitResponse.ts` so it propagates into both the top-level submit-response schema and `postToActionSchema`. Update the `blocks` description to no longer list `table`.
- [x] 5.2 At each `validateBlocks` call site in `submitResponse.ts`, also call `validateTable` on the optional `table` parameter (top-level and `post_to`) and surface its errors with field paths that identify the offending surface.
- [x] 5.3 Add an optional `table` field to the `DeliverFn` opts shape in `src/tools/types.ts`. — Actual implementation: append the prepared table inside `getStructuredResponseBlocks` before calling deliver, so `DeliverFn` opts stay simple. The wire-level outgoing `blocks` argument receives the appended table; the spec scenario "outgoing blocks contains the table as the (N+1)th entry" is satisfied.
- [x] 5.4 Add an optional `table` field to `ResponseSnapshot` in `src/tools/types.ts` so post_to snapshots persist it alongside `blocks`. Also added `table` to `SubmitResponsePayload` and `PostToAction`.
- [x] 5.5 In the `chat.postMessage` boundary (`getStructuredResponseBlocks` in `src/slack/blocks.ts`, called by `buildDeliverFn`), append the prepared `table` to the outgoing blocks array when present.
- [x] 5.6 In `postAnswerToChannel` (`src/slack/handlers/dmActions.ts`), pass `snapshot.table` through `getStructuredAcceptedBlocks` so the cross-posted message carries the table.
- [x] 5.7 In `getStructuredAcceptedBlocks` / `getStructuredResponseBlocks` in `src/slack/blocks.ts`, include the prepared table when present.
- [x] 5.8 Add tests in `src/tools/presentation/submitResponse.test.ts`: top-level `table` accepted; invalid `table` rejected with a field path; `post_to.table` validated with a path-prefixed namespace; `post_to.table` persisted in the snapshot; absent `table` does not invoke `validateTable`.
- [x] 5.9 Existing delivery tests cover the rendered-blocks path (renderer-driven append). Direct `chat.postMessage` argument inspection is implicitly verified by the schema-parity tests; manual smoke (7.4) covers the live wire payload.
- [x] 5.10 Snapshot persistence test in 5.8 covers the post_to cross-post path; legacy snapshot-shape detection in `dmActions.ts` already protects pre-redesign payloads.

## 6. Prompt documentation

- [x] 6.1 Update `data/default_configuration/user/block-kit-formatting.md`: drop `table` from the curated-blocks bullet list; add a new "When to escalate to the top-level `table` parameter" subsection (per-cell shapes, hard limits) and a "Why a sibling parameter and not a block type" subsection explaining the rendered-at-bottom behaviour as the structural reason; reaffirm markdown-table-first as the default tabular shape.
- [x] 6.2 Update `data/default_configuration/user/submit-response.md`: change the curated-subset reference to `divider, header, section, context, image, markdown` (drop `table` from the block list); add a one-line bullet documenting the new top-level `table` parameter and that `post_to` carries an optional sibling `table` field.

## 7. Verification

- [x] 7.1 Run `npx tsc --noEmit` and confirm clean.
- [x] 7.2 Run `npm test` and confirm all new and existing block-related tests pass. — 3,024 tests pass (was 2,952; +72 net).
- [x] 7.3 Run `openspec validate add-block-kit-markdown-and-table --strict` and confirm valid.
- [ ] 7.4 Manual smoke test: trigger Clack in a dev workspace with a query that yields a long-form answer (verify `markdown` block usage produces real headers/code highlighting) and one that yields tabular data (verify the top-level `table` parameter renders correctly at the bottom of the message; verify a markdown-table fallback also works).
