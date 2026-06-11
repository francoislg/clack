# Gemini Image Plugin

The `gemini-image` plugin gives Claude a `generate_image` tool backed by Google's Gemini image models via the official [`@google/genai`](https://github.com/googleapis/js-genai) SDK. Claude can **generate** a brand-new image from a text prompt or **edit** an uploaded image (image-to-image), then post the result into a Slack channel.

> **Every image it produces is AI-GENERATED.** It is synthetic — not a photograph, not a real screenshot or document, and not a real depiction of any actual person, place, brand, or event. The tool's description and result envelope say so explicitly, and it returns no license/attribution metadata. This is deliberate: it keeps the tool from being picked up as a real-subject image source (e.g. by the trivia plugin's visual-question flow, which discovers sources by description).

## Behavior

- **One MCP tool**, `mcp__gemini-image__generate_image`, member-gated.
- **Generate**: `generate_image({ prompt })` → an image from the prompt.
- **Edit**: `generate_image({ prompt, input_image_url })` → image-to-image; `prompt` is the edit instruction and `input_image_url` is the `url_private` of an uploaded Slack image (or any image URL). Edits run on an edit-capable model.
- **Quality tiers**: `quality: "fast"` (default) or `"best"`. Claude never sees raw model IDs — only the tier. The tier→model map is configurable (see below).
- **Delivery** (`deliver`):
  - `"upload"` (default) — posts the image to a Slack `channel` you supply (optionally threaded via `thread_ts`), with a neutral filename. Returns `{ fileId, permalink }`.
  - `"data"` — returns the image inline for Claude to inspect; does **not** post to Slack.
  - `"both"` — posts AND returns inline.

  Because plugin tools have no per-session channel context, `upload`/`both` require an explicit `channel`. In DMs and channelless runs (where no Channel ID is surfaced to Claude) only `data` is available.

## Authentication

Uses a Google Gemini API key.

### Step 1: Get an API key

1. Open [Google AI Studio](https://aistudio.google.com/apikey).
2. Sign in and create an API key.

### Step 2: Set the API key

Add to `data/auth/.env`:

```env
GEMINI_API_KEY=your_gemini_api_key
```

(The plugin reads `process.env.GEMINI_API_KEY`. No `config.json` key field.)

## Configuration

### Enable the plugin

Make sure `"gemini-image"` appears in `data/config.json → plugins`:

```json
{
  "plugins": ["gemini-image"]
}
```

### Tier → model mapping (optional override)

Built-in defaults:

| Tier   | Model                        |
| ------ | ---------------------------- |
| `fast` | `gemini-2.5-flash-image`     |
| `best` | `gemini-3-pro-image-preview` |
| edit   | `gemini-2.5-flash-image`     |

To repoint a tier without a code change, create `data/plugins/gemini-image/models.json` with any subset of the keys — it merges over the defaults and **hot-reloads** (no restart):

```json
{
  "best": "gemini-3-pro-image-preview"
}
```

Invalid JSON or wrong field types fall back to the defaults rather than breaking the tool.

### Restart Clack

On startup you should see:

```
Plugin "gemini-image" loaded: 1 instructions, 1 tools
```

## Notes

- **No key set?** The plugin still loads, but every `generate_image` call returns a friendly error pointing the admin at `data/auth/.env`. Everything else keeps working.
- **No upstream URL.** Gemini returns raw image bytes, not a hosted URL. The only shareable reference is the Slack-hosted `permalink` from an upload — and that is auth-gated, so it won't render if pasted into an `image` block's `image_url`. The upload itself already makes the image visible in the channel.
- **Safety filters.** If Gemini refuses a prompt, the model returns no image and the tool surfaces a "try rephrasing" error.
- **Self-hosting concerns.** The prompt text (and, for edits, the input image bytes) are sent to Google. No Slack user IDs or thread context are sent.

## References

- [Google AI Studio — API keys](https://aistudio.google.com/apikey)
- [`@google/genai` SDK](https://github.com/googleapis/js-genai)
- [Gemini image generation docs](https://ai.google.dev/gemini-api/docs/image-generation)
