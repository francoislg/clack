## Why

When Claude makes many consecutive tool calls in the same group (e.g., reading 20 files), the Slack task card grows one detail line per call. The header already shows a `(20)` count, so the per-item lines become noise and push other content out of view. We want to cap the visible detail lines while still tracking the total count in the header — and make that cap configurable, so noisy groups can be tightened (or quiet groups loosened) without code changes.

## What Changes

- Add `taskCards.maxDetailsPerGroup` to `data/config.json` (number, default `5`) as the global cap on detail lines rendered per grouped tool task card.
- Extend the `groups` field in tool mapping configs (`data/{default_,}configuration/tool_mapping/*.json`) to accept either the existing string title OR an object `{ title: string, maxDetails?: number }` — per-group override, backward-compatible with existing string values.
- Resolution order at render time: per-group `maxDetails` → `taskCards.maxDetailsPerGroup` in `config.json` → built-in fallback (`5`).
- `slackStreamer` stops appending detail lines once a group's `count` exceeds its resolved cap. The header title continues to increment (`Reading files (20)`).
- `maxDetails: 0` is a valid value — produces a header-only task card with no detail lines.
- Same mechanism extends to the file-level `group` shorthand: configs that use top-level `group: "..."` may add a sibling `maxDetails: <number>` field.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `tool-label-config`: schema gains optional `maxDetails` on per-group entries (polymorphic `groups` values) and an optional top-level `maxDetails` next to the file-level `group` shorthand.
- `streaming-responses`: tool-call progress rendering gates detail-line emission on a per-group cap.

## Impact

- **Code**: `src/streaming/toolMappingLoader.ts` (schema parsing), `src/streaming/toolLabels.ts` (`ToolGroupInfo` carries `maxDetails`), `src/streaming/slackStreamer.ts` (gate the three detail-append sites on `openGroup.count <= maxDetails`), `src/config.ts` (load `taskCards.maxDetailsPerGroup`).
- **Config**: `data/config.json` gains an optional `taskCards` section. Existing configs continue to work — `taskCards` is absent in current `config.json`, so the built-in default (`5`) applies.
- **Tests**: new tests in `src/streaming/slackStreamer.test.ts` (cap behavior), `src/streaming/toolMappingLoader.test.ts` (polymorphic `groups` parsing).
- **No breaking changes**: existing tool mapping files with string `groups` values continue to work unchanged; no config migration needed.
