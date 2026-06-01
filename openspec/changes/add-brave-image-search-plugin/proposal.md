## Why

`add-trivia-visual-questions` defines an external MCP tool contract for image search, and `add-commons-image-search-plugin` covers canonical Wikipedia/Commons subjects (flags, people, landmarks, paintings, history, animals). What's left is the **long tail**: movie scene stills, TV stills, video game characters, anime character art outside Jikan's coverage, comic characters, regional figures missing from English Wikipedia, contemporary pop culture, and arbitrary generic subjects ("smiling capybara in a hot spring"). For these, no specialized free API exists — what *does* exist is generic web image search.

Brave Search Images API is the right primitive: a generic image-search HTTP API with a free tier (~2000 queries/month), no scraping, ToS allows programmatic use, and a single key on signup. Adding this plugin closes the long-tail coverage gap for visual trivia, at the cost of less canonical results (no stable IDs, license/attribution often unknown) and a per-deployment admin keying step.

The licensing posture is the user's judgment call, made deliberately and documented: trivia images are re-hosted via Slack `files.uploadV2` to a private workspace audience with attribution shown on reveal — functionally equivalent to a human sharing a public image link in a Slack channel for a fun internal trivia game.

## What Changes

- **New Clack plugin** at `src/plugins/brave-image-search/` registered in the plugin loader. The plugin exposes a single MCP tool: `mcp__brave_image_search__find_image(query: string)`.
- **Tool returns multimodal result in data mode**: one image content block with `{ type: "image", data: "<base64>", mimeType }` (the downloaded top-result bytes) + one text content block with `{ source: "brave", subjectId, title, imageUrl, license, attribution, format: "data" }`. The MCP tool-result type only supports data-mode image blocks — URL-source blocks aren't expressible — so the plugin downloads the chosen image; `imageUrl` is preserved in the metadata for the downstream post-time upload hop.
- **`subjectId` namespacing**: `brave:<first-12-chars-of-sha256(imageUrl)>` — a URL-hash identifier since Brave search results lack a stable native ID. Less reliable than Wikidata QIDs but acceptable because (a) most subjects route to specialized plugins first (Brave is the last-resort fallback), and (b) the trivia inspection gate provides a secondary signal for duplicates.
- **`license` is the literal string `"unknown"`.** Brave returns search results, not licensing metadata. The trivia reveal renders attribution as `📷 Image via <source domain>` (extracted from the result's source page URL host).
- **`attribution` format**: `"via <source-domain>"` where `<source-domain>` is the host of the source web page (`new URL(result.source).host`). Falls back to `"via Brave Search"` if the host can't be extracted.
- **Free API key required.** Plugin reads the key from `process.env.BRAVE_API_KEY` (set in `data/auth/.env`, the bot's plugin-secret convention — plugin hard rules forbid importing core config). When the key is unset, the tool returns `{ kind: "keyMissing" }` — trivia's visual research subflow silently moves on (per the visual-questions contract).
- **Brave-specific result filtering** in the tool: prefer results where the image MIME type is JPEG / PNG / WebP / GIF (skip SVGs and oddities); skip results with obvious watermark domains in metadata when detectable.
- **Rate-limit etiquette**: Brave's free tier is ~1 req/sec, ~2000 req/month. Plugin sets the documented `X-Subscription-Token` header (free-tier auth) and surfaces `kind: "rateLimit"` on 429 after one bounded retry.
- **Structured error returns** per the visual-questions contract: `notFound`, `rateLimit`, `network`, `unknown`, `keyMissing`.
- **No persistent storage.** Stateless plugin — every call is an HTTP round-trip to Brave.

## Capabilities

### New Capabilities

- `brave-image-search`: the Brave Search Images MCP tool, its contract conformance (multimodal URL-mode return, structured errors, URL-hash subjectId namespacing, keyMissing semantics for opt-in plugins).

### Modified Capabilities

(none)

## Impact

- **Code**: new `src/plugins/brave-image-search/` directory with `index.ts` (plugin entry + tool registration), `findImage.ts` (the tool implementation), `brave.ts` (HTTP adapter to Brave Search API), and corresponding `.test.ts` files. Plugin loader registration (same pattern as the Commons plugin).
- **External dependencies**: Brave Search Images API (`https://api.search.brave.com/res/v1/images/search`). Requires admin to sign up at search.brave.com for a free API key. No new npm packages — built-in `fetch`.
- **Configuration**: optional `BRAVE_API_KEY` in `data/auth/.env` (the bot's plugin-secret convention). When the key is unset, the plugin loads but its tool returns `keyMissing` on every call — trivia handles this gracefully (silent fall-through to other available image-search tools, or fall-back to text medium).
- **Tests**: mock the Brave Search HTTP layer. Happy path (returns image block + text block with `brave:<hash>` subjectId and `via <domain>` attribution). Error paths (keyMissing when key unset, rate-limit retry, 5xx network, malformed response). URL-hash determinism (same imageUrl → same subjectId).
- **User-visible behavior**: with Brave plugin installed and key configured, visual trivia rounds can now cover any subject that's findable via web image search — including movie scenes, TV stills, character art, contemporary pop culture, regional figures, and arbitrary generic subjects. With Brave installed but key unset, the plugin is a no-op (`keyMissing`), and trivia falls through to other image-search plugins (or text). Without Brave installed at all, behavior is unchanged.
- **Licensing posture**: documented explicitly in design.md. This plugin downloads the chosen image only to return it inline for Claude's inspection (data mode), and `post_questions` re-hosts it via `imageUrl` for a private workspace audience with attribution shown on reveal. Admins enabling this plugin make that judgment call deliberately.

## Dependencies

This change depends on `add-trivia-visual-questions` defining the external image-search MCP tool contract. It does NOT depend on `add-commons-image-search-plugin` — the two are independent plugins. In practice, both should be installed for best coverage (Commons handles canonical subjects, Brave handles the long tail), but neither is a hard prerequisite for the other.
