# Tenor (GIF) Plugin

The `gif` plugin gives Claude a `find_gif` tool backed by [Tenor](https://tenor.com/). When enabled, Claude can include a GIF URL in its response and Slack unfurls it inline — no uploads, no Block Kit image blocks.

## Behavior

- **Search**: one MCP tool, `mcp__gif__find_gif({ query, limit? })`, returns an array of `{ url, previewUrl, title }`.
- **SFW only**: every request is sent with Tenor's strictest filter (`contentfilter=high`). Not configurable.
- **Randomized**: repeated calls with the same query don't return the same GIF — Tenor's `random=true` shuffles results server-side.
- **Default limit is 1**: the tool returns a single result unless Claude asks for more (up to 10).
- **Forbidden in reaction (ephemeral) responses**: enforced via Claude's baseline instructions.
- **Attribution**: any message containing a GIF must include `via Tenor` (required by Tenor's Terms of Service).
- **One GIF per message** maximum.

## Authentication

Tenor is a Google product. The API key is a standard Google Cloud API key scoped to the Tenor API.

### Step 1: Enable the Tenor API in Google Cloud

1. Open the [Google Cloud Console](https://console.cloud.google.com).
2. Pick (or create) a project.
3. Go to **APIs & Services → Library**, search for **"Tenor API"**, click **Enable**.

### Step 2: Create an API key

1. Go to **APIs & Services → Credentials**.
2. Click **+ Create credentials → API key**.
3. (Optional but recommended) Click **Restrict key → API restrictions** and limit it to the Tenor API so a leaked key can't be used for anything else.
4. Copy the key.

The key does not expire. It can be deleted or rotated at any time from the same page.

## Configuration

### 1. Set the API key

Add to `data/auth/.env`:

```env
GIF_TENOR_API_KEY=your_tenor_api_key
```

The non-secret `client_key` identifier sent with every request is hard-coded to `clack` (Tenor uses it for analytics only).

### 2. Enable the plugin

Make sure `"gif"` appears in `data/config.json → plugins`:

```json
{
  "plugins": ["trivia", "gif"]
}
```

### 3. Restart Clack

On startup you should see:

```
Plugin "gif" loaded: 1 instructions, 1 tools
```

## Notes

- **No key set?** The plugin still loads, but every `find_gif` call returns a friendly error pointing the admin at `data/auth/.env`. Everything else keeps working.
- **Rotation**: delete the key from Google Cloud *Credentials*, create a new one, update `data/auth/.env`, restart.
- **Rate limits**: Tenor's per-project quotas are generous and do not require production-key review (unlike GIPHY). If you ever hit a limit, the tool returns a `TenorError` with the HTTP status and body.
- **Self-hosting concerns**: the only data sent to Tenor is the query string. No Slack content, user IDs, or thread context leaks.

## References

- [Tenor API overview](https://developers.google.com/tenor/guides/endpoints)
- [Tenor API attribution requirements](https://developers.google.com/tenor/guides/attribution)
- [Tenor content filters](https://developers.google.com/tenor/guides/content-filters)
- [Google Cloud Console](https://console.cloud.google.com)
