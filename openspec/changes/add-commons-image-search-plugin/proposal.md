> **Note — discovery convention superseded.** This proposal's references to the `*_image_search__*` tool-name convention are superseded by `fix-visual-trivia-tool-discovery`: trivia now discovers image sources by tool **description**, not by a name substring. Tool names are no longer matched (and resolve with hyphens, e.g. `mcp__commons-image-search__find_subject`). Reconcile the wording here when this change is next worked on.

## Why

The `add-trivia-visual-questions` change defines an external MCP tool contract for image search but ships no image-source code. Visual trivia rounds remain non-functional until at least one image-search plugin is installed. Wikimedia Commons (paired with Wikipedia REST) is the natural first plugin: keyless, free, broad coverage of canonical subjects (flags, people, landmarks, paintings, history, currency, animals), generous rate limits, and well-defined license/attribution metadata. Once this plugin is installed, every visual trivia category in the seed pool that maps to Commons-canonical subjects becomes immediately playable.

## What Changes

- **New Clack plugin** at `src/plugins/commons-image-search/` registered in the plugin loader. The plugin exposes a single MCP tool: `mcp__commons_image_search__find_subject(query: string)`.
- **Tool returns multimodal result in data mode**: one image content block with `{ type: "image", data: "<base64>", mimeType }` (the downloaded `thumbnail.source` bytes) + one text content block with `{ source: "commons", subjectId, title, imageUrl, license, attribution, format: "data" }`. The MCP tool-result type only supports data-mode image blocks — URL-source blocks aren't expressible — so the plugin downloads the thumbnail; `imageUrl` is preserved in the metadata for the downstream post-time upload hop.
- **`subjectId` namespacing**: `wikidata:Q<n>` when the Wikipedia page summary has a `wikibase_item` (preferred — stable across page renames), else `wikipedia:<slug>` fallback.
- **Thumbnail.source preference**: the plugin SHALL use `thumbnail.source` from the Wikipedia REST page summary, NOT `originalimage.source`. `thumbnail.source` is a rasterized PNG/JPEG render at ~320–640px, suitable for direct embedding. `originalimage.source` is often an SVG master (flags, coats of arms, diagrams) that doesn't render reliably in Slack `hero_image` blocks. This single rule unlocks flag-trivia.
- **License + attribution** sourced from Commons `imageinfo.extmetadata` (`LicenseShortName` + `Artist`/`Credit` fields). When metadata is missing, license falls back to `"unknown"` and attribution falls back to `"via Wikimedia Commons"`.
- **Structured error returns** per the visual-questions contract: `notFound`, `rateLimit` (429/503 from Wikimedia after bounded retry), `network` (5xx after retry, timeout), `unknown` (malformed response — missing expected fields).
- **No API key required.** The plugin enables itself when present in the plugin loader; admins disable it via standard plugin disable mechanism.
- **Rate-limit etiquette**: descriptive `User-Agent` header per Wikimedia API policy; bounded retry-with-backoff (max 2 retries, jittered) on 429/503.
- **No persistent storage.** The plugin is stateless — every call is an HTTP round-trip to Wikipedia/Commons. Thumbnail bytes are downloaded only to return them inline (data mode) and are never persisted or cached (Wikimedia's CDN handles caching upstream of us).

## Capabilities

### New Capabilities

- `commons-image-search`: the Wikipedia REST + Wikimedia Commons MCP tool, its contract conformance (multimodal URL-mode return, structured errors, thumbnail.source preference, subjectId namespacing).

### Modified Capabilities

(none)

## Impact

- **Code**: new `src/plugins/commons-image-search/` directory with `index.ts` (plugin entry + tool registration), `findSubject.ts` (the tool implementation), `wikimedia.ts` (HTTP adapter to Wikipedia REST + Commons API), `index.test.ts` and per-file tests. Plugin loader registration (`src/plugins/index.ts` or equivalent — verify where plugins enumerate themselves).
- **External dependencies**: Wikipedia REST API (`https://en.wikipedia.org/api/rest_v1/page/summary/<title>`) and Wikimedia Commons API (`https://commons.wikimedia.org/w/api.php`). Both keyless, free, HTTPS. No new npm packages — built-in `fetch`.
- **Configuration**: no breaking changes. Optional `config.plugins.commonsImageSearch.enabled` (default `true` when the plugin is present); no other config needed (no API key).
- **Tests**: mock the Wikimedia HTTP layer. Happy path (returns image block + text block, correct namespaced subjectId, license/attribution populated). Error paths (notFound, rate-limit retry, 5xx network, malformed response). Thumbnail preference (when both `thumbnail.source` and `originalimage.source` are present, plugin uses thumbnail).
- **User-visible behavior**: trivia visual rounds for Commons-canonical categories (flags, people, landmarks, paintings, history, animals, currency) become playable once `promptMedium.image > 0` is configured AND `visualCategories.json` is populated AND this plugin is installed.

## Dependencies

This change depends on `add-trivia-visual-questions` defining the external image-search MCP tool contract. The trivia plugin's prompt discovers this tool by name (`*_image_search__*`) at runtime — no trivia code changes are needed to consume this plugin once both ship.
