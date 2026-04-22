## Why

Clack's responses are text-only today. Adding a GIF capability lets Claude react with visual humor or emphasis when the moment calls for it (celebrations, acknowledgements, playful DMs) without risking hallucinated URLs. A dedicated tool backed by a real provider keeps every GIF URL verifiable.

## What Changes

- Add a new always-on plugin `gif` (under `src/plugins/gif/`) following the existing Clack plugin pattern (mirrors `trivia`).
- Register the plugin in `data/config.json → plugins: [..., "gif"]`.
- Expose one MCP tool: `mcp__gif__find_gif({ query, limit? })` → returns an array of `{ url, previewUrl, title }` sourced from Tenor.
- Ship baseline user instructions (`user/gif__usage.md`) telling Claude when and how to use `find_gif`, including the hard rule: **never paste a GIF URL that didn't come from the tool**.
- Read the Tenor API key from `GIF_TENOR_API_KEY` in `data/auth/.env`. If missing, the tool returns a helpful error but the plugin still loads.
- Forbid GIF usage in reaction-triggered (ephemeral) responses via the instructions; allowed in DM and @mention modes.
- Require Tenor attribution ("via Tenor") in any message that includes a GIF.

## Capabilities

### New Capabilities
- `gif-plugin`: The GIF search capability — Tenor-backed `find_gif` tool, SFW-enforced results, trigger-mode scoping rules, and attribution requirements.

### Modified Capabilities
<!-- None — the plugin ships entirely through existing extension points (clack-plugins SDK, cascading-config-resolver) without changing their contracts. -->

## Impact

- **Code**: new `src/plugins/gif/` directory (plugin entry, Tenor client, tool definition, instructions file, tests).
- **Config**: `data/config.json` gets `"gif"` appended to `plugins`.
- **Secrets**: `GIF_TENOR_API_KEY` added to `data/auth/.env` (documented in setup).
- **Dependencies**: no new npm packages — use native `fetch`.
- **External services**: Tenor API (Google Cloud), subject to Google's ToS including attribution.
- **Existing systems touched**: plugin registry (`src/plugins/registry.ts`) — one-line registration. No changes to cascading config resolver, MCP manager, or Slack rendering paths.
