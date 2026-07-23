# Tasks — Adopt Modern Slack Blocks

## 1. Interactive data_table rendering

- [x] 1.1 Raise the `table` row cap in `validateTable` to 200 (variant-dependent: 100 legacy / 200 `data_table`); error message names the active limit
- [x] 1.2 Add `src/slack/tableRender.ts`: authored table → `data_table` block (cell mapping, default `page_size` constant, `caption`), plus a serialized-size estimate that falls back to a legacy `table` block (with a log) when the converted block would exceed the 20k-char cap
- [x] 1.3 Wire `getStructuredResponseBlocks` AND `getStructuredAcceptedBlocks` (`src/slack/blocks.ts`) to emit the rendered table so `submit_response` and `post_to` (auto-execute + button-click) both honor it
- [x] 1.4 Unit tests: conversion mapping, 200-row cap, oversized fallback to legacy table

## 2. Chart parameter

- [x] 2.1 Add `chartBlockSchema` (looseObject, JSON-Schema-safe) + `AuthoredChartBlock` type to `blockSchema.ts`
- [x] 2.2 Add `validateChart` (pie⇄segments / series exclusivity, series/point/label/title caps, unique series names) to `blockValidate.ts` with friendly errors
- [x] 2.3 Add `chart` to the shared `messageContentFields` fragment so it appears on `submit_response` and `post_to`; thread it through the payload/action/snapshot types and validation loop (mirroring `table`)
- [x] 2.4 Render `data_visualization` at delivery (`src/slack/chartRender.ts`, wired in `blocks.ts`), positioned after content blocks and before the table block
- [x] 2.5 Persist `chart` in the `post_to` snapshot alongside `table`
- [x] 2.6 Unit tests: validation matrix, delivery positioning (chart before table), render mapping
- [x] 2.7 Update `response-rendering` topic instructions (when to use charts / the data_table variant; note the caps)

## 3. Wrap-up

- [x] 3.1 Check npm for a `@slack/types` release covering `data_table`/`data_visualization` — latest (3.0.0) equals installed and still lacks them; no bump available, raw-block approach stands
- [x] 3.2 `npx tsc`, `npm test`, `npx oxlint`/`npx oxfmt` on touched files
- [x] 3.3 Run `graphify update .` to refresh the knowledge graph
