# Adopt Modern Slack Blocks

## Why

Slack's 2025–2026 Block Kit wave shipped two high-value primitives Clack doesn't use yet: the `data_table` block (native pagination, sorting, and filtering, up to 200 data rows vs the legacy `table` block's static rendering) and the `data_visualization` block (native pie/bar/area/line charts). Adopting them upgrades Clack's answer rendering from static tables and no charts to interactive data surfaces.

## What Changes

- **`data_table` variant for the top-level `table` parameter**: the existing `table` parameter on `submit_response` / `post_to` gains an optional `variant: "table" | "data_table"` field (default `"table"`) plus an optional `caption`. The default keeps today's legacy static `table` block (column alignment preserved) — best for small aligned tables like leaderboards. `variant: "data_table"` emits a Slack `data_table` block (pagination, sortable columns, 200-row cap) — best for large result sets; it drops `column_settings` (Slack's data_table has no per-column alignment) and falls back to the legacy `table` block when a converted table exceeds Slack's 20,000-character aggregate cap (with a log). The authored payload shape is otherwise unchanged; Claude picks the variant per use case.
- **New top-level `chart` parameter** on `submit_response` and each `post_to` action: a curated, zod-validated payload (`chart_type: pie | bar | area | line`, segments/series, axis config) rendered as a Slack `data_visualization` block. Mirrors the `table` parameter pattern — a structured sibling parameter, NOT a free-form member of `blocks`, so validation stays deterministic. Rendered after content blocks and before the table when both are present.
- Prompt/instruction updates in the `response-rendering` topic so Claude knows when to reach for charts and large tables.
- `@slack/types` version bump if a release covering the new blocks is available; otherwise local schema types (our block schemas are `looseObject`-based and do not depend on upstream types).

## Capabilities

### New Capabilities

<!-- None — this change modifies an existing capability only. -->

### Modified Capabilities

- `clack-tool-response`: the top-level `table` parameter gains a `variant` selecting the legacy `table` (default) or an interactive `data_table` block (raised row cap, oversize fallback), and a new top-level `chart` parameter is added alongside it on `submit_response` and `post_to`, rendered as a `data_visualization` block.

## Impact

- `src/slack/blockSchema.ts` (chart schema, table row-cap change), `src/slack/blockValidate.ts` (`validateChart`, raised row cap), `src/slack/tableRender.ts` (new — table → `data_table` conversion + oversize fallback), `src/slack/blocks.ts` (delivery: emit `data_table` / `data_visualization`), `src/tools/types.ts` + `src/tools/presentation/submitResponse*` (new `chart` parameter, validation, snapshot), `data/default_configuration/user/topics/response-rendering/` instruction updates.
- No config changes — the new blocks are always used (no opt-in flag, no way to disable).
- No manifest/scope changes — both blocks work with existing `chat:write`.
- Risk: `data_table` / `data_visualization` are recent GA blocks; older Slack clients may render them degraded. Accepted — the whole point is to use the new blocks.
