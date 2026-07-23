# Design — Adopt Modern Slack Blocks

## Context

Clack's answer rendering already supports a curated authorable block set (`divider`, `header`, `section`, `context`, `image`, `markdown`, `card`, `carousel` — `src/slack/blockSchema.ts`) plus a top-level `table` parameter rendered as a legacy `table` block. Slack has since shipped `data_table` (interactive: pagination, sorting; up to 200 data rows, ≤20 columns, ≤20k chars) and `data_visualization` (pie/bar/area/line; ≤12 segments/series, ≤20 points per series).

Constraints:

- The installed `@slack/types` does NOT type `data_table`/`data_visualization` (`KnownBlock` stops at `TableBlock`). Our zod schemas are `looseObject`-based and don't depend on upstream types, so no bump is required to ship; the emitted blocks are built as raw block objects.
- Tool schemas must stay JSON-Schema serializable (`z.looseObject`, no `z.custom`, no refine-wrapped union members) — established in `blockSchema.ts`.

## Goals / Non-Goals

**Goals:**

- Let the top-level `table` parameter opt into an interactive `data_table` render via a `variant` field, keeping the legacy static table as the default (no regression to existing aligned tables).
- A `chart` top-level parameter (sibling to `table`) rendered as a `data_visualization` block, on `submit_response` and `post_to`.

**Non-Goals:**

- No new Claude-authorable member of the `blocks` union (both new data blocks arrive as structured sibling parameters).
- No config flag / workspace toggle. The table render is chosen per-table via `variant`; the chart is always available.
- No `container` or `alert` block adoption.

## Decisions

### D1: `variant` selects legacy `table` vs `data_table`, same authored shape

Slack's `data_table` is not a drop-in for the legacy `table`: it adds pagination + sorting (great for large result sets) but has **no per-column alignment** (`column_settings` doesn't exist there) and requires a `caption`. Converting every table would silently drop alignment on existing aligned tables (e.g. trivia leaderboards). So the authored `table` gains an optional `variant: "table" | "data_table"` field (default `"table"`) — Claude picks per use case: the default legacy static block for small aligned tables, `data_table` for large scrollable/sortable ones. This keeps existing tables byte-for-byte unchanged and needs no config flag.

At delivery, the outbound block-building path (`getStructuredResponseBlocks` / `getStructuredAcceptedBlocks` in `src/slack/blocks.ts`) renders via a new `src/slack/tableRender.ts` helper. Default variant → the legacy `table` block (with `column_settings` preserved). `variant: "data_table"` → a `data_table` block: string/`raw_text` cells map 1:1, `rich_text` cells pass through, a default `page_size` constant and a `caption` (authored or default) are applied, and `column_settings` is dropped. Claude selects the variant, never the raw Slack block type.

*Alternative rejected:* always `data_table` — silently regresses alignment on existing tables. *Also rejected:* a config flag to toggle it globally — the choice is per-table, not per-workspace.

*Row cap:* 100 for the default variant, 200 for `data_table` (`validateTable`, variant-dependent); the error message names the active limit.

*Oversize fallback:* Slack caps a `data_table` at 20,000 serialized characters — a content-dependent limit, not row-count. When `tableRender` estimates the converted block would exceed it, delivery emits the legacy `table` block for that message (with a log line) instead of failing. Runtime graceful fallback, not a config switch.

### D2: `chart` is a top-level sibling parameter, mirroring `table`

`chartBlockSchema` (new, in `blockSchema.ts`): `{ chart_type: "pie" | "bar" | "area" | "line", title? (≤50), segments? (pie: 1–12 of { label ≤20, value }), series? (bar/area/line: 1–12 of { label ≤20, points 1–20 }), axis_config? }`. Pie requires `segments` and forbids `series`; the other three the inverse — enforced in a `validateChart` function (the `validateTable`/`validateCard` pattern), not zod refinements, to keep JSON-Schema serialization safe. Rendered as a `data_visualization` block appended after `blocks` and before the table (if both present).

`chart` lives in the shared `messageContentFields` fragment alongside `table`, so it appears on both the top-level `submit_response` and every `post_to` action with no gating — exactly like `table`. The `post_to` snapshot persists `chart` next to `table`.

*Why sibling parameter:* same reasons as `table` — deterministic validation, single-instance constraint, and Slack's rendering caps are easier to enforce structurally than inside a free-form union. *Alternative rejected:* adding `data_visualization` to the `blocks` union — weaker validation errors and lets Claude author multiple charts.

### D3: No `@slack/types` bump required

Ship on local zod schemas and raw block objects. Opportunistically bump `@slack/types` when a release covering `data_table`/`data_visualization` exists (a task checks), but nothing blocks on it.

## Risks / Trade-offs

- [New blocks render degraded on old Slack clients] → accepted; the goal is to use the new blocks. No opt-out.
- [`data_table` aggregate 20k-char cap is content-dependent] → `tableRender` estimates serialized size and falls back to the legacy `table` block (with a log) instead of failing delivery.

## Migration Plan

No config, no data migration. Deploying changes the emitted block type for tables and adds a `chart` parameter. No manifest or scope changes.

## Open Questions

- Exact `page_size` default for `data_table` (start with a taller 10 for leaderboard-style tables vs Slack's default 5) — decided at implementation with a constant.
