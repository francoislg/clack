# Gemini Image Plugin

The `gemini-image` plugin gives Claude a `generate_image` tool backed by Google's Gemini image models via the official [`@google/genai`](https://github.com/googleapis/js-genai) SDK. Claude can **generate** a brand-new image from a text prompt or **edit** an uploaded image (image-to-image). The result is **stored** in Slack (not posted anywhere) and returned as a file handle Claude can render wherever it wants.

> **Every image it produces is AI-GENERATED.** It is synthetic — not a photograph, not a real screenshot or document, and not a real depiction of any actual person, place, brand, or event. The tool's description and result envelope say so explicitly, and it returns no license/attribution metadata. This is deliberate: it keeps the tool from being picked up as a real-subject image source (e.g. by the trivia plugin's visual-question flow, which discovers sources by description).

## Behavior

- **One MCP tool**, `mcp__gemini-image__generate_image`, member-gated.
- **Generate**: `generate_image({ prompt })` → an image from the prompt.
- **Edit**: `generate_image({ prompt, input_image_url })` → image-to-image; `prompt` is the edit instruction and `input_image_url` is the `url_private`/`permalink` of an uploaded Slack image, a `permalink` from an earlier `generate_image` call, or any image URL. Edits run on an edit-capable model.
- **Quality tiers**: `quality: "fast"` (default) or `"best"`. Claude never sees raw model IDs — only the tier. The tier→model map is configurable (see below).
- **Delivery — store, then render.** The tool does **not** post the image. It uploads it to Slack **unshared** (no `channel_id`, owned by the bot) and returns `{ fileId, permalink }`. No `channel` argument — it works identically in DMs, channels, and channelless runs.
  - **To show it**, Claude emits an `image` block referencing the stored file by id: `{ "type": "image", "slack_file": { "id": "<fileId>" }, "alt_text": "…" }` — in `submit_response`, a `post_to`, or a `deliver_to`. This renders a private file inline without a public URL (`slack_file` accepts `{ id }` or `{ url }`, never both). Curated image blocks accept `slack_file` as an alternative to `image_url` (see `src/slack/blockValidate.ts`).
  - **To refine before showing**, generate, then call again with `input_image_url` set to the previous `permalink`, and only render the final pick.

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
- **No upstream URL.** Gemini returns raw image bytes, not a hosted URL. The image is stored as a Slack file; reference it by `fileId` via an image block's `slack_file: { id }` (not `image_url`, which is for public URLs). The stored file's `permalink` is auth-gated but works as an `input_image_url` for follow-up edits (the tool fetches it with the bot token).
- **Safety filters.** If Gemini refuses a prompt, the model returns no image and the tool surfaces a "try rephrasing" error.
- **Self-hosting concerns.** The prompt text (and, for edits, the input image bytes) are sent to Google. No Slack user IDs or thread context are sent.

## References

- [Google AI Studio — API keys](https://aistudio.google.com/apikey)
- [`@google/genai` SDK](https://github.com/googleapis/js-genai)
- [Gemini image generation docs](https://ai.google.dev/gemini-api/docs/image-generation)
