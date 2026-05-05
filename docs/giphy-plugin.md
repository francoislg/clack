# GIPHY Plugin

The `giphy` plugin gives Claude a `find_gif` tool backed by [GIPHY](https://giphy.com/) via the official [`@giphy/js-fetch-api`](https://github.com/Giphy/giphy-js/tree/master/packages/fetch-api) SDK. When enabled, Claude can include a GIF URL in its response and Slack unfurls it inline as a Block Kit `image` block.

This is a sibling to the [Tenor plugin](./tenor-plugin.md) — same tool surface, different provider. Use one or the other; loading both registers two distinct MCP servers (`mcp__gif__find_gif` and `mcp__giphy__find_gif`).

## Behavior

- **Search**: one MCP tool, `mcp__giphy__find_gif({ query, limit? })`, returns an array of `{ url, previewUrl, title }`.
- **SFW only**: every request is sent with GIPHY's `rating=g` filter. Not configurable.
- **Randomized**: GIPHY's search endpoint has no `random=true` flag, so a random `offset` (0–24) is sent with each request to vary results across calls.
- **Default limit is 1**: the tool returns a single result unless Claude asks for more (up to 10).
- **Forbidden in reaction (ephemeral) responses**: enforced via Claude's baseline instructions.
- **Attribution**: any message containing a GIF must include a `Powered by GIPHY` note (required by GIPHY's Terms of Service).
- **One GIF per message** maximum.

## Authentication

GIPHY API keys are issued through the GIPHY Developer Portal.

### Step 1: Create an app and get an API key

1. Open the [GIPHY Developer Dashboard](https://developers.giphy.com/dashboard/).
2. Sign in with a GIPHY account (free).
3. Click **Create an App**, pick the **API** option (not SDK), give it a name, accept terms.
4. Copy the API key shown on the dashboard.

The key is initially a **beta key** with a per-IP rate limit. For production you can request a **production key** through the same dashboard — GIPHY reviews the app before approving.

### Step 2: Set the API key

Add to `data/auth/.env`:

```env
GIPHY_API_KEY=your_giphy_api_key
```

## Configuration

### Enable the plugin

Make sure `"giphy"` appears in `data/config.json → plugins`:

```json
{
  "plugins": ["giphy"]
}
```

### Restart Clack

On startup you should see:

```
Plugin "giphy" loaded: 1 instructions, 1 tools
```

## Notes

- **No key set?** The plugin still loads, but every `find_gif` call returns a friendly error pointing the admin at `data/auth/.env`. Everything else keeps working.
- **Rotation**: revoke the key from the GIPHY dashboard, create a new one, update `data/auth/.env`, restart.
- **Rate limits**: beta keys have stricter per-IP limits than production keys. If you hit a limit, the SDK throws a `FetchError` (re-exported as `GiphyError`) with the HTTP status — the tool surfaces that to Claude.
- **Self-hosting concerns**: the only data sent to GIPHY is the query string. No Slack content, user IDs, or thread context leaks.

## References

- [GIPHY Developer Portal](https://developers.giphy.com/)
- [GIPHY Search endpoint](https://developers.giphy.com/docs/api/endpoint#search)
- [`@giphy/js-fetch-api` README](https://github.com/Giphy/giphy-js/tree/master/packages/fetch-api)
- [GIPHY API attribution requirements](https://developers.giphy.com/docs/sdk#attribution)
