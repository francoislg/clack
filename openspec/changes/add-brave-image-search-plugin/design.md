## Context

The visual-questions external tool contract defines what an image-search plugin must do; the Commons plugin covers canonical subjects from Wikipedia/Commons. This plugin handles the long-tail residue — subjects that don't have a clean canonical source. The category routing falls to Claude (the visual-questions design makes this explicit): Claude reads tool descriptions, matches the rolled category against each tool's stated coverage, and picks the best fit. Brave's tool description says "generic web image search; last-resort fallback for subjects not covered by specialized plugins."

Brave Search Images API is the cleanest free generic-search option:

- **API model**: REST endpoint at `https://api.search.brave.com/res/v1/images/search?q=<query>`. Authentication via `X-Subscription-Token: <api-key>` header. Returns JSON with a `results` array; each result has `properties.url` (the image URL), `source` (page URL), `title`, `thumbnail.src` (a smaller preview URL), and various other fields.
- **Free tier**: 2000 requests/month, ~1 request/second. Documented ToS allows programmatic use including chatbot integration.
- **Coverage**: indexes the open web. Returns whatever's findable — movie stills, character art, pop culture, contemporary news photos, generic stock-style images. License is per-source-page, which Brave doesn't surface in the response.

The user's framing for using a generic search source is deliberate: "Not that different than me taking an image link on the internet and sharing it in a Slack channel — this is just a game for fun about who is this actor." Trivia images are re-hosted to Slack's private CDN, attribution is shown at reveal, audience is a private workspace. Admins enabling this plugin tacitly accept this posture; the design documents it so the choice is explicit.

Stakeholders: trivia plugin's visual-research prompt (consumer), admins enabling visual rounds (need to sign up at search.brave.com and add a key to config), Claude during scheduled runs (calls the tool, inspects the inline-fetched image, writes the question or re-rolls).

## Goals / Non-Goals

**Goals:**

- Implement the visual-questions tool contract for Brave Search Images in data mode: download the top renderable result and return it as a base64 image content block plus metadata (the URL is preserved in the metadata for the downstream post-time upload hop).
- Surface `keyMissing` cleanly when the API key is unset, so trivia's visual research subflow falls through silently.
- Source-namespace subjectId via URL hash (`brave:<sha256-prefix>`) since Brave results have no native canonical ID.
- Best-effort attribution from the source page's domain. License is always `"unknown"` (Brave returns search results, not licensing metadata) — surfaced as-is on reveal.
- Skip results whose image is not JPEG/PNG/WebP/GIF (Brave occasionally surfaces SVGs and oddities; we want renderable results).
- Bounded retry-with-backoff on 429/5xx; structured errors on every failure mode.
- Stateless plugin — no caching, no key reuse beyond the load-time read.

**Non-Goals:**

- License compliance for the underlying source. Brave indexes the open web; license is unknowable from search results alone. Admins enabling this plugin make the call.
- Cross-source subject dedup. URL-hash subjectIds are intentionally distinct from Wikidata QIDs and other source-namespaced IDs — the visual-questions proposal accepts cross-source dedup misses as a documented tradeoff.
- Web scraping or alternative search backends. If admins want a different generic-search source (SerpAPI, Tavily, etc.) they can ship a separate plugin; this one is Brave-only.
- Per-result ranking or boost rules. Trust Brave's relevance ordering; take the top JPEG/PNG/WebP/GIF result.
- Image content moderation (NSFW filtering). Brave Search has a `safesearch` parameter (defaults to `strict`); we use the default. Subject-level NSFW concerns are out of scope; the trivia category pool curation is the admin's gatekeeper.
- Free-tier quota management UI. Admins approaching 2000 req/month see Brave's 429 surfaced; tracking remaining quota is out of scope (Brave's dashboard handles it).

## Decisions

### Decision 1: Data-mode return (base64 image content block)

The plugin SHALL return the chosen image as a **data-mode** MCP content block — `{ type: "image", data: "<base64>", mimeType }` — by downloading the selected result URL and base64-encoding the bytes. The text metadata block carries `format: "data"`; `imageUrl` is still included so `post_questions` can re-fetch it.

**Why data-mode and not URL-mode?** Same reason as the Commons plugin (see `add-commons-image-search-plugin` Decision 1): the MCP `CallToolResult` type only expresses image content as `{ type: "image", data, mimeType }` — there is no URL-source image variant in the tool-result content union. URL-mode is not expressible as a typed tool result, so the plugin downloads the selected image. Plugin = one HTTP call to Brave + one image download + MIME detection + a 5 MB cap + metadata assembly. Still small, still stateless.

### Decision 2: `subjectId` is `brave:<first-12-chars-of-sha256(imageUrl)>`

Brave Search results have no stable native canonical ID. The plugin SHALL derive `subjectId` from the chosen image URL via SHA-256, taking the first 12 hex characters and prefixing with `brave:`.

**Why URL hash?** Three reasons:

1. **Determinism per URL.** Same image URL on two different days → same subjectId → trivia's `find_previous_subjects` correctly flags it as a duplicate.
2. **Privacy / opacity.** The hash doesn't leak the source URL into trivia's stored question records (which would otherwise show up in `find_previous_subjects` responses).
3. **Acceptable instability.** If Brave returns a different CDN URL for the "same" image on a different day (mirror, cache variant), the hash differs and we'd ask the same subject twice. Acceptable: as the last-resort fallback adapter, most subjects route to specialized plugins with proper IDs; this miss is a minority case.

12 hex chars = 48 bits of namespace. Collision probability at any realistic scale is negligible (millions-to-one).

**Alternative considered**: hash the source page URL instead of the image URL. Rejected — multiple images can come from the same source page (e.g., a Wikipedia page or a movie database entry); hashing the source page would conflate them. Hashing the image URL is more specific.

### Decision 3: `license: "unknown"` always; `attribution` derived from source-page domain

Brave Search doesn't return licensing metadata in search results — only the image URL, source page URL, title, dimensions, and similar. The plugin SHALL set:

- `license: "unknown"` (literal string, every response).
- `attribution: "via <host>"` where `<host>` is `new URL(result.source).host` of the source page (e.g., `"via en.wikipedia.org"`, `"via imdb.com"`). Falls back to `"via Brave Search"` if the host can't be extracted (malformed source URL).

**Why surface `"unknown"` rather than omit?** The visual-questions reveal flow renders `📷 Image: <attribution>` and gracefully degrades when license is absent — but explicit `"unknown"` is more honest than implicit absence. Admins see at reveal that this subject came from a generic search.

**Tradeoff:** strict CC compliance is the admin's responsibility, not the plugin's. The plugin's job is to surface what Brave returns. License compliance for the underlying source falls under the licensing posture (Decision 4).

### Decision 4: Licensing posture — internal trivia, deliberate admin choice

The plugin SHALL NOT enforce any license-side filtering. Brave Search indexes the open web; results may include copyrighted content. Admins enabling this plugin do so knowing trivia images are re-hosted via Slack to a private workspace audience with attribution shown on reveal — functionally equivalent to a human sharing a public image link in a Slack channel for a fun game.

The design.md SHALL document this posture explicitly. The plugin's README SHALL link to this design section. Admins who don't want this posture should not install this plugin.

**Why document it here?** Trivia is private/internal, but the plugin itself doesn't enforce that — a hypothetical future use of this plugin in a public-facing context would be on the admin to evaluate. Pinning the posture in design.md sets the expectation clearly.

### Decision 5: Result filtering — JPEG/PNG/WebP/GIF only

Brave occasionally returns SVG results and other non-Slack-friendly formats. The plugin SHALL iterate through Brave's `results[]` array in rank order and pick the first result whose image URL has a renderable extension (`.jpg` / `.jpeg` / `.png` / `.webp` / `.gif`) — case-insensitive. If no such result exists in the top 10, return `{ kind: "notFound" }`.

**Why check URL extension instead of Content-Type?** Brave doesn't return Content-Type in the search result metadata; checking would require a HEAD request per candidate, which doubles per-call latency for marginal benefit. Extension is a strong-enough heuristic for trivia's needs; the rare false negative (extensionless URL that IS a valid JPEG) is acceptable.

**Why top 10?** Brave returns ~20 results by default. Iterating past 10 hits diminishing returns for relevance; if the top 10 contain no renderable image, the query is likely too niche for visual trivia and re-rolling to a different subject is the right move.

### Decision 6: `keyMissing` semantics for opt-in tools

The plugin SHALL load successfully even when the API key is unset. The tool's `find_image` call SHALL return `{ kind: "keyMissing", message: "Brave Search API key not configured — set BRAVE_API_KEY in data/auth/.env" }` on every call until a key is configured.

**Key location — env var, not config:** the plugin hard rules (`src/plugins/CLAUDE.md`) forbid plugin code from importing `src/config.ts`, and the established secret convention is `data/auth/.env` → `process.env` (e.g. giphy reads `process.env.GIPHY_API_KEY`). This plugin therefore reads `process.env.BRAVE_API_KEY` rather than a `config.plugins.braveImageSearch.apiKey` field, which would require a forbidden core-config import. This supersedes the original proposal's config-path wording.

The visual-questions tool contract specifies that `keyMissing` is silent at the trivia level — the prompt sees the tool is "available but currently can't run" and moves on to another image-search tool (or falls back to text). The admin sees the message in logs / debug surfaces.

**Why not refuse to load the plugin when key is unset?** Loading-with-stub lets admins install the plugin first and add the key later without a restart. Common deployment pattern: ship the bot, then opt into Brave later when you decide it's needed.

### Decision 7: Rate-limit handling — bounded retry on 429, surface on second hit

Brave's free tier limits to ~1 request/second. The plugin SHALL:

- On 429: retry once with 1-second backoff. If retry also 429, return `{ kind: "rateLimit", message }`.
- On 5xx: retry once with 500ms backoff. If retry also 5xx, return `{ kind: "network", message }`.
- Set `Accept: application/json` and `X-Subscription-Token: <api-key>` headers.
- Timeout: 5 seconds per call.

**Why a small retry budget?** Brave is more rate-limited than Wikimedia. Aggressive retries waste the monthly quota; one retry is a polite acknowledgment of transient hiccups without compounding the load.

## Risks / Trade-offs

- **[Risk] Free-tier quota exhaustion.** Heavy multi-game deployments could approach 2000 req/month. → **Mitigation**: Brave returns 429 when the monthly quota is hit; the plugin surfaces `rateLimit`, and trivia falls through to other image-search tools or text. If real usage exceeds the free tier, admins upgrade Brave's plan or self-throttle by limiting `promptMedium.image` weight.

- **[Risk] Brave returns a misleading image.** Generic web search is noisier than canonical sources. A query for "Inception" might return a poster, a meme, a still, or unrelated content. → **Mitigation**: NOT this plugin's concern. The visual-questions image-inspection gate is Claude's job — Claude sees the image, decides whether it's suitable for the question shape, and re-rolls if not.

- **[Risk] Licensing posture is sensitive.** Some admins may not want trivia images from arbitrary web sources, even with attribution. → **Mitigation**: This plugin is opt-in (free key required). Admins who don't want the posture don't install it. The Commons plugin remains the canonical-only option. Decision 4 documents the posture explicitly so the choice is informed.

- **[Risk] URL-hash subjectId instability across Brave CDN variants.** Brave may return slightly different image URLs (mirror, query params, CDN host) for the same underlying image on different days. The hash differs, and we ask the same subject twice. → **Mitigation**: Documented as accepted. Most subjects route to specialized plugins with stable IDs; Brave is the last-resort fallback where this miss is least painful.

- **[Risk] Attribution leaks subject identity.** `"via en.wikipedia.org"` is benign; `"via deadliest-warrior-fandom.com"` might leak the subject from the domain name. → **Mitigation**: Acceptable for the v1 internal-trivia posture; if real abuse surfaces, the plugin can strip subdomains and normalize attribution to a small allowlist of "neutral" surfaces. Out of scope for v1.

- **[Risk] Top-10 filtering misses a relevant result.** A relevant image might be at rank 11+ if Brave's relevance ranking is off for the query. → **Mitigation**: Trust Brave's ranking + accept the rare miss. If real usage shows consistent rank-11+ relevance, raise the iteration limit.

- **[Trade-off] No license enforcement.** The plugin doesn't filter out copyrighted content. → **Accepted**: licensing posture is on the admin (Decision 4). Trivia is private/internal-trivia by design; admins evaluating broader deployment make their own call.

- **[Trade-off] Hash-based subjectId is opaque to admins.** Looking at a saved question's `media.subjectId: "brave:a3f4..."` tells admins nothing about what the image was. → **Accepted**: `media.title` carries the human-readable subject (from Brave's `title` field); admins inspect title, not hash. The hash is purely a dedup key.

## Migration Plan

No migration. Plugin is purely additive — new directory, new tool. Existing trivia data is unaffected. Existing visual trivia rounds (if Commons plugin was already installed) keep working with Commons; adding Brave gives Claude an additional tool to pick from.

Admins enable visual rounds with Brave by:

1. Sign up at https://search.brave.com/api → obtain a free API key.
2. Add `BRAVE_API_KEY=<key>` to `data/auth/.env` (the bot's plugin-secret convention; loaded into `process.env` at boot).
3. Restart the bot. The plugin loads, the tool registers under `mcp__brave_image_search__find_image`, and Claude can call it on the next scheduled trivia run.

**Rollback**: remove the key (or uninstall the plugin entirely). With the key removed, the tool returns `keyMissing`; trivia silently falls through to other available image-search tools.

## Open Questions

- **Should `safesearch` be admin-configurable?** Brave's `safesearch` param defaults to `strict`; some deployments might want `moderate`. Default: keep `strict` for v1, add a config knob in a follow-up if requested.

- **Should the plugin track quota usage locally?** Brave returns rate-limit / quota headers in responses; we could surface a "X/2000 used this month" metric. Out of scope for v1; admins use Brave's dashboard.

- **Should `find_image` accept an optional `category` argument?** Could refine the query (e.g., "Inception movie scene" vs just "Inception"). Currently the plugin trusts Claude to construct an appropriately-specific `query`. Default: no for v1 — keep the tool's contract minimal.
