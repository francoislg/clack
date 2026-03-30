## Why

Users sometimes ask Clack about custom emojis in the workspace — what's available, what a specific emoji looks like, or which emojis match a theme. Currently Claude has no way to look up workspace emojis, so it can only guess or decline. A `find_emoji` tool gives Claude access to the workspace's custom emoji list so it can answer these questions directly.

## What Changes

- Add an `EmojiCache` abstraction that lazily fetches and caches the full custom emoji list from the Slack `emoji.list` API (single call, no pagination needed)
- Add a `find_emoji` query tool that searches cached custom emojis by name (substring and wildcard matching), returning name, URL, and alias information
- Register the tool when a Slack client is available (no role gating — emojis are not sensitive)
- Add a tool mapping entry in `clack.json` for the `find_emoji` tool label

## Capabilities

### New Capabilities
- `find-emoji-tool`: MCP query tool and supporting cache for searching custom Slack workspace emojis by name

### Modified Capabilities
- `clack-tools`: New tool registration in `buildQueryTools` — `find_emoji` gated on `ctx.slackClient`
- `tool-label-config`: New entry in `clack.json` for `find_emoji` label

## Impact

- **Slack API**: Requires `emoji:read` bot token scope (must be added in Slack app configuration and app reinstalled)
- **New files**: `src/slack/emojiCache.ts`, `src/tools/query/findEmoji.ts`
- **Modified files**: `src/tools/server.ts` (register tool), `data/default_configuration/tool_mapping/clack.json` (add label)
- **No breaking changes** — additive only
