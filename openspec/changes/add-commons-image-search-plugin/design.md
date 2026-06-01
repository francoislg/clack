## Context

`add-trivia-visual-questions` defines a contract: any MCP tool whose name contains `image_search` may be called by trivia's visual-research subflow. Tools return a multimodal result — image content block (URL-mode or data-mode) plus a text content block with `{ source, subjectId, title, imageUrl, license?, attribution?, format }`. This plugin is the first concrete implementation.

Wikipedia's REST `/page/summary/<title>` endpoint and Wikimedia Commons' MediaWiki API are the canonical sources for the categories trivia ships with today: flags, people, landmarks, paintings, history, currency, animals. Both APIs are free, keyless, HTTPS, and well-rate-limited (rough budget per Wikimedia's policies: be polite, set a `User-Agent`, back off on 429/503). Coverage is excellent for subjects with their own Wikipedia article; gaps appear for pop-culture (album covers, movie scenes — copyright-restricted on Commons) — those are deferred to other plugins.

One concrete pitfall warrants design-level attention: Wikipedia's article main image often resolves to an SVG master via `originalimage.source` (flags, coats of arms, line drawings, diagrams), while `thumbnail.source` returns a rasterized PNG/JPEG render at ~320–640px. The trivia card's `hero_image` Block Kit element renders PNG/JPEG reliably but is inconsistent with SVG. Always preferring `thumbnail.source` is what makes flag trivia work.

Stakeholders: trivia plugin's visual-research prompt (consumer of this tool's output), admins enabling visual rounds (operationally: install the plugin, no key needed), Claude during scheduled question-generation runs (calls the tool, reads the inline image, writes the question).

## Goals / Non-Goals

**Goals:**

- Implement the visual-questions tool contract for Wikipedia/Commons in data mode: download the upstream `thumbnail.source`, return it as a base64 image content block plus metadata (the URL is preserved in the metadata for the downstream post-time upload hop).
- Prefer `thumbnail.source` over `originalimage.source` so flag/coat-of-arms/diagram subjects resolve to PNG renders.
- Set Wikidata QID as the canonical `subjectId` when available; fall back to the Wikipedia page slug. Both are source-namespaced (`wikidata:` / `wikipedia:`).
- Extract license + attribution from Commons `imageinfo.extmetadata` when possible; degrade gracefully to `license: "unknown"` + `attribution: "via Wikimedia Commons"` when missing.
- Bounded retry-with-backoff on 429/503; structured errors back to the trivia prompt on every failure mode.
- Stateless plugin — no caching, no key, no persistent storage. Wikipedia/Commons CDNs handle the caching upstream.

**Non-Goals:**

- Image re-hosting / persistence. The plugin downloads the thumbnail bytes only to return them inline for Claude's inspection (data mode) — it does NOT persist or re-host them. Trivia's `post_questions` performs the Slack file-upload hop at post time by re-fetching `imageUrl` (already specified by the visual-questions proposal).
- Cross-source dedup. The plugin's `subjectId` is namespaced (`wikidata:` / `wikipedia:`); deduplication across sources is intentionally not performed (trivia's `find_previous_subjects` does exact-string matching only).
- Pop-culture coverage (album covers, movie scenes, brand logos). Those hit copyright walls on Commons; separate plugin proposals handle them.
- SVG support. The `hero_image` Slack block renders inconsistently with SVG; the plugin uses thumbnail renders. If `thumbnail.source` is itself an SVG (rare — Wikipedia returns PNG thumbnails even for SVG masters by default), the plugin returns `kind: "unsupportedFormat"`.
- Per-language Wikipedia routing. The plugin queries English Wikipedia (`en.wikipedia.org`) only in v1. Multi-language is a follow-up if real demand surfaces.
- Image inspection / quality validation. The plugin returns whatever Wikipedia surfaces as the article's main image. Claude's image-inspection gate (defined in the visual-questions proposal) catches mismatched / leaky / unsuitable images at the trivia prompt level.

## Decisions

### Decision 1: Data-mode return (base64 image content block)

The plugin SHALL return the image as a **data-mode** MCP content block — `{ type: "image", data: "<base64>", mimeType: "<image/...>" }` — by downloading the chosen `thumbnail.source` and base64-encoding the bytes. The text metadata block carries `format: "data"`. `imageUrl` (the `thumbnail.source` URL) is still included in the metadata so downstream consumers can re-fetch it.

**Why data-mode and not URL-mode?** The MCP `CallToolResult` type (returned by the Claude Agent SDK's `tool(...)` helper, sourced from `@modelcontextprotocol/sdk`) expresses an image content block ONLY as `{ type: "image", data, mimeType }`. There is **no URL-source image variant** in the tool-result content union — `source: { type: "url", url }` is the Anthropic Messages API shape, not an MCP tool-result shape. The repo's only image-tool-result precedent (`src/tools/query/viewSlackImage.ts`) confirms this: it base64-encodes bytes. URL-mode is therefore not expressible as a typed tool result, so the plugin downloads the thumbnail and returns the bytes. This was the blocking dependency flagged by `add-trivia-visual-questions` task 7b.2; resolved here in favor of data-mode.

**Cost of data-mode:** one extra HTTP call (the thumbnail download) plus MIME detection (Content-Type header, falling back to the URL extension) and a 5 MB size cap (oversized → `unsupportedFormat`). The plugin is three HTTP calls (page summary + thumbnail download + Commons imageinfo for license metadata) and a content-block assembly. Still small, still stateless, still keyless.

**Implication for trivia:** `post_questions`'s Slack file-upload hop re-fetches `imageUrl` at post time (the plugin downloaded the bytes for Claude's inspection; `post_questions` downloads them again for the upload). Acceptable: Wikipedia's CDN serves the same thumbnail bytes both times, the second fetch is cheap, and decoupling means the inspection and upload phases don't have to share state.

### Decision 2: Always prefer `thumbnail.source` over `originalimage.source`

The Wikipedia REST `/page/summary` response carries two image URLs: `thumbnail.source` (rasterized render at a reasonable size) and `originalimage.source` (the canonical master, often an SVG for flags / coats of arms / diagrams / maps).

The plugin SHALL use `thumbnail.source` unconditionally as the value of `imageUrl` in both the image content block (`source.url`) and the text metadata block (`imageUrl`).

**Why?** Slack's `hero_image` Block Kit element renders PNG/JPEG/WebP/GIF reliably but is inconsistent with SVG (some clients render, some don't, some show a broken icon). The user's motivating "flag of Ecuador" example is canonical: the originalimage.source for `Flag_of_Ecuador` is the SVG master; the thumbnail.source is a 320px PNG render. Using thumbnail makes the question land cleanly in Slack.

**Tradeoff:** thumbnail resolution is capped (~640px usually). For trivia this is fine — Slack renders the hero_image at modest dimensions anyway. Loss of detail is irrelevant when the goal is "identify the subject," not "examine fine details."

**Alternative considered**: detect SVG via Content-Type and only swap to thumbnail when the original is SVG. Rejected — adds a HEAD request per call for negligible benefit; the thumbnail render is always Slack-friendly so the unconditional rule is simpler.

### Decision 3: subjectId namespacing — Wikidata QID preferred, page slug fallback

The plugin SHALL set `subjectId` to one of:

- `wikidata:Q<n>` when the page summary's `wikibase_item` field is populated (the preferred form — stable across Wikipedia page renames, language editions, and redirects).
- `wikipedia:<page-slug>` as a fallback when the page has no Wikidata QID (rare, but possible for stub articles or recently-created pages).

The plugin SHALL NOT attempt to map between the two forms or normalize them. The visual-questions proposal explicitly accepts that records stored under one form won't dedup against the other (a documented tradeoff).

**Why two forms?** Wikidata QIDs are the right canonical key but coverage is not 100%. Falling back to the page slug handles edge cases without requiring the plugin to fail-or-retry on missing QIDs.

### Decision 4: License + attribution from Commons extmetadata, with graceful degradation

The plugin SHALL call the Commons `imageinfo` API with `iiprop=url|extmetadata` to fetch license and attribution for the chosen thumbnail's source file:

- `license`: extracted from `extmetadata.LicenseShortName` (or `extmetadata.UsageTerms` as fallback). Common values: `"CC-BY-SA 4.0"`, `"Public domain"`, `"CC BY 3.0"`, etc.
- `attribution`: extracted from `extmetadata.Artist` (HTML-stripped) or `extmetadata.Credit` as fallback.

When neither field is available, `license` defaults to `"unknown"` and `attribution` defaults to `"via Wikimedia Commons"`. The plugin does NOT fail on missing metadata — many older Commons files have sparse metadata, and the trivia reveal still renders the attribution context block with whatever the plugin returned.

**Why?** CC-BY-SA's attribution requirement is satisfied when present; missing metadata is a Wikimedia-side data-quality issue, not something the plugin should surface as an error. Users see "📷 Image via Wikimedia Commons" on reveal, which is a reasonable lowest-common-denominator credit.

**Tradeoff:** attribution strings sometimes contain HTML/wikitext (`<a href="...">Some Author</a>`). The plugin strips HTML tags at extraction time but does NOT parse wikitext. Edge-case attributions may include raw `[[Wikilink]]` syntax; we render them as-is (this is rare enough to not warrant a wikitext parser).

### Decision 5: Stateless plugin, no caching

The plugin is a pure HTTP forwarder. Each `find_subject(query)` call performs:

1. `GET /api/rest_v1/page/summary/<urlencoded(query)>` to Wikipedia REST.
2. `GET <thumbnail.source>` to download the thumbnail bytes (data-mode image block).
3. `GET /w/api.php?action=query&titles=<File:...>&prop=imageinfo&iiprop=url|extmetadata` to Commons (for license/attribution on the chosen thumbnail's source file).

There is no in-memory cache, no on-disk cache, no de-duplication of in-flight requests. Wikimedia's CDN handles edge caching; the plugin doesn't need to duplicate.

**Why?** Caching would add state, complicate lifecycle (cache invalidation, size cap, eviction), and provide marginal benefit for trivia's scheduled-run cadence (cron fires every few hours, not several times per second). Statelessness keeps the plugin trivially testable and operationally invisible.

### Decision 6: Rate-limit etiquette per Wikimedia policy

The plugin SHALL:

- Set `User-Agent` header to `Clack-Trivia-Image-Search/1.0 (https://github.com/<repo>; <admin-email-or-placeholder>)` per Wikimedia API etiquette (https://meta.wikimedia.org/wiki/User-Agent_policy).
- Implement bounded retry-with-backoff on `429` (Too Many Requests) and `503` (Service Unavailable): max 2 retries with jittered backoff (base 500ms, doubling). After retry budget is exhausted, return `kind: "rateLimit"` with a message indicating the upstream status.
- On 5xx other than 503: 1 retry, then surface `kind: "network"` with the response detail.
- Timeout: 5 seconds per HTTP call (page summary OR imageinfo). The trivia visual-research subflow has its own retry budget on top of this.

**Why these specifics?** Wikimedia's documented preference is to throttle to a few QPS per User-Agent. For trivia's scheduled-run usage this is way under the limit, but the etiquette costs nothing and protects against future heavy use.

### Decision 7: English Wikipedia only in v1

The plugin queries `en.wikipedia.org/api/rest_v1` and `commons.wikimedia.org` (Commons is language-neutral). Other-language Wikipedias are NOT consulted.

**Why?** Trivia categories and queries are English-source; non-English fallback risks subject confusion ("Mercury" in en-wiki = the planet by default; in fr-wiki it might land on the Roman god). A future change can add per-language routing if non-English deployments emerge.

**Tradeoff:** subjects that only exist in non-English Wikipedias (regional figures, language-specific topics) won't be found by this plugin. Acceptable: Brave Search Images (separate plugin) provides the cross-language long-tail fallback.

## Risks / Trade-offs

- **[Risk] Wikipedia page rename between save and post.** A question saved with `imageUrl = X` might find X 404 at post time if the page or file was renamed. → **Mitigation**: thumbnail URLs on Wikimedia's CDN are stable (path-based on file content hash), so renames typically don't break them. If the upstream URL is genuinely gone, `post_questions`'s file-upload hop returns a per-item error and trivia retries on the next fire.

- **[Risk] Wikidata QID missing for stub/new articles.** Some recently-created articles lack a Wikidata QID at the time the plugin queries them. → **Mitigation**: Fall back to `wikipedia:<slug>` as documented in Decision 3. Page slugs are less stable than QIDs but acceptable for the rare case.

- **[Risk] License metadata absent or malformed.** Older Commons files sometimes have empty or sparsely-populated `extmetadata`. → **Mitigation**: `license: "unknown"` + `attribution: "via Wikimedia Commons"` fallbacks documented in Decision 4. The reveal renders a degraded but valid attribution line.

- **[Risk] Wikipedia article main image is unsuitable.** Some articles' primary image is a coat of arms, a map, a 19th-century engraving, or a diagram rather than a subject photograph. → **Mitigation**: NOT this plugin's concern. The visual-questions proposal's image-inspection gate (Claude self-check) handles this at the trivia prompt level — Claude calls the plugin, sees the image, decides it's unsuitable, re-rolls with a different query.

- **[Risk] Wikimedia rate-limiting under aggressive multi-game load.** A workspace with many active trivia games could approach Wikimedia's polite-use limits. → **Mitigation**: Retry-with-backoff on 429 (Decision 6); structured error `kind: "rateLimit"` lets trivia re-roll to a different subject. If real users hit this consistently, follow-up changes can add request-level coalescing or fall back to Brave Search Images.

- **[Trade-off] No SVG support.** Subjects whose only Commons image is an SVG (rare — most have PNG thumbnails available) won't render in trivia. → **Accepted**: thumbnail.source preference handles 99%+ of cases; the rare miss returns `unsupportedFormat` and trivia tries another subject.

- **[Trade-off] English Wikipedia only.** Subjects that exist primarily in non-English Wikipedias won't be found. → **Accepted**: Brave Search Images plugin (separate change) covers the cross-language long tail; this plugin's scope is the English-Wikipedia canonical set.

## Open Questions

- **Should the plugin expose a separate tool for explicit Wikidata-QID lookup?** Use case: Claude has already resolved disambiguation upstream (e.g., from a previous WebSearch step) and wants to skip Wikipedia's title-based search. Default decision: no for v1 — `query` is sufficient; can add `find_by_qid(qid)` later if disambiguation problems surface in practice.

- **Configurable User-Agent contact info?** Wikimedia recommends including an admin contact in the User-Agent. Default: hardcode a generic `Clack-Trivia-Image-Search/1.0` string. If Wikimedia ever flags the bot, we'll surface a config knob for admin-email then.

- **Per-game rate-limit?** Should the plugin track per-game request counts and self-throttle? Default: no — global etiquette + Wikimedia's own rate-limiting are enough. Revisit if real throttling occurs.
