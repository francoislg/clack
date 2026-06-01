# Brave (Image Search) Plugin

The `brave-image-search` plugin gives Claude a `find_image` tool backed by the [Brave Search Images API](https://search.brave.com/api). It's the **long-tail / last-resort** image source for visual trivia — movie scenes, TV stills, video game and anime/comic character art, contemporary pop culture, and regional figures that aren't in Wikipedia/Commons. For canonical subjects (flags, world leaders, landmarks, paintings, currencies, animals) prefer the keyless `commons-image-search` plugin; Claude picks between installed image-search tools by reading their descriptions.

## Behavior

- **Search**: one MCP tool, `mcp__brave_image_search__find_image({ query })`, returns a multimodal result — a **data-mode image block** (the downloaded image, base64) for Claude to inspect, plus a text block with `{ source, subjectId, title, imageUrl, license, attribution, format }`.
- **Result filtering**: the plugin picks the first top-10 result whose image is renderable (JPEG/PNG/WebP/GIF); SVGs and oddities are skipped. If none qualify it returns `notFound`.
- **subjectId**: `brave:<first-12-hex-of-sha256(imageUrl)>` — deterministic per image URL (used by trivia for dedup). Brave has no stable native ID.
- **License is always `"unknown"`**: Brave returns search results, not licensing metadata. `attribution` is `via <source-page-domain>` (e.g. `via imdb.com`), falling back to `via Brave Search`.
- **SafeSearch**: every request is sent with `safesearch=strict`. Not configurable.
- **Stateless**: no cache; each call is a fresh HTTP round-trip to Brave plus one image download.

## Licensing posture (read before enabling)

Brave indexes the open web, so results may include copyrighted content and the plugin enforces **no** license-side filtering (`license: "unknown"` always). Trivia images are re-hosted via Slack to a **private workspace** audience with attribution shown on reveal — functionally equivalent to a person sharing a public image link in a Slack channel for a fun internal game. Enabling this plugin accepts that posture; see `openspec/changes/add-brave-image-search-plugin/design.md` Decision 4. Admins who don't want it should stick to `commons-image-search` (canonical-only).

## Authentication

Brave Search has a free API tier (~2000 requests/month, ~1 request/second) with a single key on signup.

### Step 1: Get an API key

1. Go to [search.brave.com/api](https://search.brave.com/api).
2. Sign up and subscribe to a plan that includes **Images** (the free tier works).
3. Copy the subscription token (API key).

The plugin sends it as the `X-Subscription-Token` header on every request.

## Configuration

### 1. Set the API key

Add to `data/auth/.env`:

```env
BRAVE_API_KEY=your_brave_subscription_token
```

(The plugin reads `process.env.BRAVE_API_KEY` — the same `data/auth/.env` convention as the other media plugins. No `config.json` key field.)

### 2. Enable the plugin

Make sure `"brave-image-search"` appears in `data/config.json → plugins`:

```json
{
  "plugins": ["trivia", "commons-image-search", "brave-image-search"]
}
```

### 3. Restart Clack

On startup you should see:

```
Plugin "brave-image-search" loaded: 0 instructions, 1 tools
```

## Notes

- **No key set?** The plugin still loads, but every `find_image` call returns `{ kind: "keyMissing" }` pointing the admin at `data/auth/.env`. Trivia's visual subflow silently falls through to another image-search tool (or to a text-medium question) — no errors, no broken cards. Add the key later and restart.
- **Rate limits / quota**: on `429` the plugin retries once (jittered ~1s backoff) then returns `{ kind: "rateLimit" }`; trivia moves on. Track remaining monthly quota on Brave's dashboard. If you consistently hit the cap, upgrade Brave's plan or lower the `promptMedium.image` weight.
- **Rotation**: revoke/regenerate the token in the Brave dashboard, update `data/auth/.env`, restart.
- **Self-hosting concerns**: the only data sent to Brave is the query string. No Slack content, user IDs, or thread context leaks. The selected image is downloaded once (to return it inline for Claude) and is not persisted.

## References

- [Brave Search API](https://search.brave.com/api)
- [Brave Image Search API docs](https://api-dashboard.search.brave.com/app/documentation/image-search/get-started)
- Plugin source: `src/plugins/brave-image-search/` · README: `src/plugins/brave-image-search/README.md`
