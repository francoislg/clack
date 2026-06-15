## Context

`add-trivia-visual-questions` defines the external MCP tool contract; `add-commons-image-search-plugin` Decision 1 resolved the URL-mode-vs-data-mode question: MCP `CallToolResult` content type only supports data-mode image blocks (`{ type: "image", data, mimeType }`), so every image-search plugin downloads bytes and base64-encodes. This plugin follows that resolution.

TMDB (The Movie Database) is the canonical free API for movie / TV / actor metadata and imagery. Free key at https://www.themoviedb.org/settings/api. The relevant endpoints:

- `/search/movie?query=<q>` — returns movies sorted by relevance. Each result has `id`, `title`, `release_date`, `poster_path`, `backdrop_path`, and various other fields.
- `/search/tv?query=<q>` — same shape for TV series; `name` instead of `title`, `first_air_date` instead of `release_date`.
- `/search/person?query=<q>` — returns people; each has `id`, `name`, `profile_path`, and `known_for` (list of credited works).

Image paths from these endpoints are relative — they need to be combined with the image CDN base URL and a size variant: `https://image.tmdb.org/t/p/<size>/<path>`. Available sizes vary by image type (poster, backdrop, profile) and are documented at `/configuration`. For trivia, fixed reasonable sizes are sufficient.

The trivia visual-research subflow picks tools by reading their descriptions and matching against the rolled category. With three separate tools (`find_movie`, `find_tv`, `find_person`), Claude has clear signals: "Movies" → `find_movie`, "Actors" → `find_person`, etc. A single omnibus tool would force Claude to pass a `kind` argument, which is more error-prone and adds prompt overhead.

TMDB's terms of use require attribution for any application using its data: "This product uses the TMDB API but is not endorsed or certified by TMDB." For trivia's purpose, the reveal's attribution context block (`📷 Image: Data and images via TMDB (themoviedb.org)`) satisfies this. The plugin SHALL emit this attribution string verbatim on every successful response.

Stakeholders: trivia plugin's visual-research prompt (consumer), admins enabling visual rounds (sign up at themoviedb.org, add key to config), Claude during scheduled runs (calls the appropriate tool for the rolled category).

## Goals / Non-Goals

**Goals:**

- Implement the visual-questions tool contract in data mode for three TMDB endpoints (movie, TV, person) — one MCP tool per endpoint with clear descriptions for category-based selection.
- Surface `keyMissing` cleanly when the API key is unset, matching the opt-in plugin pattern from Brave.
- Source-namespace subjectId per TMDB's content kinds (`tmdb:m-<id>`, `tmdb:tv-<id>`, `tmdb:p-<id>`).
- Emit TMDB's mandatory attribution string verbatim on every successful response.
- Use fixed, sensible image sizes from TMDB's CDN (balance Slack render quality vs. 5 MB cap vs. base64 overhead).
- Skip results lacking imagery (null `poster_path` / `profile_path`); fall through to the next result in TMDB's relevance order until one has imagery or top-10 is exhausted.
- Bounded retry-with-backoff on 429/5xx; structured errors on every failure mode.
- Stateless plugin — no caching, no key reuse beyond load-time read.

**Non-Goals:**

- Backdrops / stills / episode-still trivia. v1 returns posters (movies / TV) and profiles (actors). "Scene still" trivia is a follow-up if real demand surfaces — requires choosing between `backdrop_path` (movie/TV) and per-episode stills, which adds complexity.
- TV-by-episode or movie-by-collection searches. The plugin searches by free-text query (movie title / TV series name / person name). Episode-level or collection-level lookups are out of scope.
- IMDB-ID-based direct lookup. TMDB supports `/find/<imdb-id>?external_source=imdb_id` but this isn't needed for trivia's text-query flow. Optional follow-up if Claude wants to disambiguate via IMDB IDs.
- TMDB v4 advanced features (lists, watchlist, account integration). Plugin uses TMDB v3 (or v4 search auth-only) — read-only search.
- Localization. Plugin queries TMDB with `language=en-US` (the default). Other languages are a follow-up if non-English deployments emerge.
- Per-tool config knobs (e.g., "always use backdrops for movies"). v1 is opinionated: posters for movies/TV, profiles for people, nothing else.
- Image quality validation. Trust TMDB's curation. Claude's image-inspection gate (defined in visual-questions) handles unsuitable images at the prompt level.

## Decisions

### Decision 1: Data-mode return per the MCP CallToolResult constraint

The plugin SHALL return image content blocks in data mode — `{ type: "image", data: "<base64>", mimeType: "<image/...>" }` — by downloading the chosen TMDB image and base64-encoding the bytes. The text metadata block carries `format: "data"`. `imageUrl` (the resolved TMDB CDN URL) is still included in the metadata so trivia's `post_questions` re-fetches at post time for the Slack file-upload hop.

**Why?** Same constraint as the Commons plugin (see `add-commons-image-search-plugin` Decision 1): MCP `CallToolResult` content type only expresses image blocks as data-mode. URL-mode image blocks exist in the Anthropic Messages API but are not part of the MCP tool-result content union.

**Cost:** one extra HTTP call per tool invocation (TMDB image CDN download) plus base64 encoding overhead. Acceptable: TMDB's CDN is fast, image sizes are bounded (see Decision 4), and the plugin stays stateless.

### Decision 2: Three MCP tools, one per TMDB content kind

The plugin SHALL expose three separate MCP tools:

- `mcp__tmdb_image_search__find_movie` — searches `/search/movie`, returns movie poster.
- `mcp__tmdb_image_search__find_tv` — searches `/search/tv`, returns TV series poster.
- `mcp__tmdb_image_search__find_person` — searches `/search/person`, returns actor/crew profile photo.

Each tool's description explicitly states the category fit ("Best for Movies category", "Best for TV Series category", "Best for Actors / Actresses / Filmmakers category") so Claude reads its tool list at runtime and picks the right one based on the rolled trivia category.

**Why three tools and not one omnibus `find_subject(query, kind)`?**

1. **Cleaner prompt signal.** Claude reads tool descriptions and routes by category without needing to construct a `kind` argument. A typo or category-mismatch on `kind` would fail silently; with separate tools, the choice is structural.
2. **Endpoint-specific tuning.** TMDB's movie / TV / person endpoints differ in result structure (`title` vs `name`, `release_date` vs `first_air_date`, `poster_path` vs `profile_path`). Per-tool code paths are simpler than a generic switcher.
3. **Tool-name visibility.** Trivia's `*_image_search__*` discovery convention is per-tool. Three named tools make TMDB's coverage explicit; an omnibus tool would hide its three-way coverage behind one name.

**Tradeoff:** three tool registrations instead of one. Mild — TMDB has three first-class subject kinds and they're inherently different.

### Decision 3: subjectId kinds — `tmdb:m-`, `tmdb:tv-`, `tmdb:p-`

`subjectId` SHALL prefix the TMDB numeric ID with the kind:

- `tmdb:m-<id>` for movies (e.g., `tmdb:m-550` = Fight Club).
- `tmdb:tv-<id>` for TV series (e.g., `tmdb:tv-1399` = Game of Thrones).
- `tmdb:p-<id>` for people (e.g., `tmdb:p-287` = Brad Pitt).

These IDs are stable across TMDB's lifetime (TMDB does not reuse IDs for deleted entries).

**Why prefix by kind?** Without a kind prefix, `tmdb:550` and `tmdb:550` could in principle refer to a movie ID 550 and a TV ID 550 (different concepts) — TMDB's IDs are kind-namespaced internally but they're free to overlap as numeric values. The kind prefix prevents accidental dedup collisions between a movie and a TV show that happen to share a numeric ID.

### Decision 4: Image-size selection — fixed sizes balancing render quality vs base64 cap

The plugin SHALL use fixed image sizes from TMDB's CDN:

- **Movies + TV (posters)**: `w500` — 500px-wide poster render. JPEG, ~100–200 KB typical. Renders well in Slack `hero_image`.
- **People (profiles)**: `h632` — 632px-tall portrait. JPEG, ~80–150 KB typical. Renders well in Slack `hero_image`.

(If backdrops/stills become a v2 thing: `w780` for backdrops — 780px-wide landscape.)

**Why fixed sizes and not "original"?**

1. **Size cap.** `original` posters can be several MB; base64-encoding multiplies by ~1.33x. Staying under 5 MB after encoding is mandatory.
2. **Slack rendering.** Slack downscales `hero_image` to its own render dimensions; serving a `w500` poster is identical to serving `original` for the user's eye.
3. **Bandwidth + speed.** Smaller images mean faster downloads, faster base64-encoding, faster Claude inspection.

**Alternative considered**: query TMDB's `/configuration` endpoint at plugin load to discover available sizes dynamically. Rejected — the sizes have been stable for years, hardcoding is simpler and avoids the configuration round-trip.

### Decision 5: Result selection — first result with imagery, top 10 cap

The plugin SHALL iterate TMDB's `results` array in rank order, skipping entries where the relevant image field (`poster_path` for movies/TV; `profile_path` for person) is `null`. The plugin SHALL stop iterating at index 10. When all top-10 results lack imagery, return `{ kind: "notFound" }`.

**Why iterate past `results[0]`?** TMDB occasionally has matches with no imagery (newly-added entries, obscure titles). Falling through to the next match preserves the query's "find any image for this" semantics.

**Why cap at 10?** TMDB returns 20 results per page; past rank 10, relevance drops sharply. If the top 10 have no imagery, the query is too obscure for visual trivia and re-rolling to a different subject is the right move.

### Decision 6: TMDB attribution as a constant, not extracted from response

The plugin SHALL emit `attribution: "Data and images via TMDB (themoviedb.org)"` as a literal constant on every successful response. The `license` field SHALL be `"CC BY-NC 4.0"` per TMDB's terms.

**Why constant vs. response-derived?** TMDB doesn't return per-result attribution metadata; the attribution is a single workspace-level credit per TMDB's terms. Hardcoding the string ensures every TMDB-sourced reveal carries the correct credit.

**Trivia reveal renders this as**: `📷 Image: Data and images via TMDB (themoviedb.org) · CC BY-NC 4.0`. Long but satisfies TMDB's branding requirement.

### Decision 7: TMDB v3 auth via Bearer token

The plugin SHALL authenticate with TMDB using a `Bearer <api-key>` header on every request (TMDB v3 API endpoints accept either the `?api_key=<key>` query param OR the `Authorization: Bearer <v4-read-access-token>` header — the plugin uses the latter for cleaner request URLs).

Admins SHALL configure the v4 read access token, not the v3 API key. TMDB's settings page exposes both; the v4 token is the modern default.

**Why Bearer header instead of query param?** Avoids leaking the key in HTTP request logs. The v4 read access token has the same permissions as the v3 API key for read-only search endpoints.

### Decision 8: Stateless plugin, no caching, no config knobs

The plugin is a pure HTTP forwarder. No in-memory cache, no on-disk cache, no per-tool size overrides, no `safesearch` knob (TMDB content is family-friendly by default; explicit content is opt-in via `include_adult=true` which the plugin does NOT pass).

**Why no caching?** Same logic as Commons and Brave plugins — trivia's scheduled-run cadence is too low for caching to matter, and TMDB's CDN handles upstream caching.

**Why no config knobs?** v1 is opinionated. Image sizes, attribution string, included content kinds, and language are fixed. Admins who need different behavior fork the plugin or wait for a v2.

## Risks / Trade-offs

- **[Risk] TMDB-key signup friction.** Unlike Commons (keyless), TMDB requires admin to register, get email confirmation, generate a key, and add it to config. → **Mitigation**: documented in README; admin-facing setup guide. Free tier is generous enough that single admins don't need to share keys.

- **[Risk] TMDB rate-limit (~40 req/sec).** Trivia's scheduled cadence is way under this, but a deployment with many active games + heavy `promptMedium.image` weight could approach it. → **Mitigation**: Bounded retry-with-backoff (Decision 7 in the contract); structured `rateLimit` error lets trivia fall through to another image-search tool.

- **[Risk] No imagery on TMDB for niche titles.** Some indie movies, foreign-language TV, obscure actors have no `poster_path` / `profile_path`. → **Mitigation**: result selection iterates past missing imagery (Decision 5); when all top-10 lack imagery, `notFound` lets trivia re-roll.

- **[Risk] License is CC BY-NC (non-commercial).** TMDB's terms restrict commercial use. Trivia's internal-workspace posture satisfies this; broader deployment would not. → **Mitigation**: documented in proposal + design; admins enabling this plugin make the call. Same licensing posture conversation as Brave.

- **[Risk] Wrong TMDB result for ambiguous queries.** "Mercury" could match a movie called "Mercury," a person named "Freddie Mercury," etc. Disambiguation depends on which tool Claude calls. → **Mitigation**: per-tool routing (Decision 2) gives Claude the right endpoint for the category. The image-inspection gate (visual-questions) catches mismatched results.

- **[Risk] Image CDN failure separate from search API failure.** TMDB's search succeeds but the image CDN is down. → **Mitigation**: structured `kind: "network"` error when the CDN download fails; trivia re-rolls. (Rare in practice — TMDB's image CDN is highly available.)

- **[Trade-off] Three tools instead of one.** Slightly more registration ceremony, slightly more prompt-list surface area. → **Accepted**: cleaner routing, simpler per-tool code.

- **[Trade-off] No backdrops / stills in v1.** Some trivia formats (scene-still trivia, episode-still trivia) want a non-poster image. → **Accepted**: posters are the natural movie/TV image; stills are a v2 enhancement when real demand surfaces.

## Migration Plan

No migration. Plugin is purely additive — new directory, three new tools.

Admins enable visual rounds via TMDB by:

1. Sign up at https://www.themoviedb.org/signup, confirm email.
2. Visit Settings → API, request an API key (instant approval).
3. Copy the v4 read access token (NOT the v3 API key).
4. Add it to `config.plugins.tmdbImageSearch.apiKey` (or `data/auth/tmdb.json` — verify the existing pattern by reading `data/auth/*.json`).
5. Restart the bot. The three tools register; Claude can call them on the next scheduled trivia run.

**Rollback**: remove the key. The tools return `keyMissing` and trivia falls through to other available image-search plugins.

## Open Questions

- **Should the plugin add a fourth tool for IMDB-ID-based lookup?** Useful if Claude has resolved IMDB IDs upstream (from WebSearch or another tool). Default decision: no for v1 — text-query is sufficient; can add `find_by_imdb_id` later.

- **Should `find_movie` and `find_tv` offer a `kind: "poster" | "backdrop"` option?** Backdrops are useful for "from what movie is this scene?" trivia. Default decision: no for v1 — posters only; backdrops in a follow-up that also designs the scene-still trivia template.

- **Localization / non-English titles?** TMDB returns multilingual data with the `language` parameter. v1 uses `en-US`. If non-English deployments emerge, add per-game language config.

- **Should the plugin surface `release_date` / `known_for` to Claude in the metadata block?** Could help Claude write better question text ("This 1999 sci-fi movie..."). Default decision: no for v1 — keep the metadata block minimal; Claude has enough from the title alone.
