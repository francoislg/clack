> **Note — discovery convention superseded.** This proposal's references to the `*_image_search__*` tool-name convention are superseded by `fix-visual-trivia-tool-discovery`: trivia now discovers image sources by tool **description**, not by a name substring. Tool names are no longer matched (and would resolve with hyphens, e.g. `mcp__tmdb-image-search__find_movie`). Reconcile the wording here when this change is next worked on.

## Why

`add-trivia-visual-questions` defines an external MCP tool contract for image search; `add-commons-image-search-plugin` covers Wikipedia/Commons canonical subjects; `add-brave-image-search-plugin` covers the generic-web long tail. What sits between those two — the highest-value middle ground — is **movies, TV series, and actors**. Posters, character stills, episode stills, and actor headshots are central to the trivia categories users find most engaging ("Who is this actor?", "Which movie?", "From what TV series?"), and Wikipedia/Commons coverage for those subjects is poor (copyright walls on contemporary content; main images are often non-poster/non-still).

The Movie Database (TMDB) is the industry-standard free API for this space. Free key, generous limits (~40 req/sec, ~1M req/day on the free tier), well-documented endpoints for movies / TV / people, all image-URL responses include both `poster_path` (movie/TV poster) and `backdrop_path` (scene-still landscapes) plus `profile_path` (actor headshots). TMDB also cross-references IMDB IDs (`external_ids.imdb_id`), which is why most "IMDB-flavored" trivia projects actually use TMDB — it gives you IMDB-equivalent coverage with a proper free API instead of scraping. TMDB's terms allow non-commercial programmatic use with attribution.

This plugin unlocks visual trivia for the categories `Movies`, `TV Series`, `Actors` that the visual-questions seed pool ships with.

## What Changes

- **New Clack plugin** at `src/plugins/tmdb-image-search/` registered in the plugin loader. The plugin exposes **three MCP tools** (one per subject kind, matching TMDB's API split):
  - `mcp__tmdb_image_search__find_movie(query: string)` — movie poster (or backdrop on opt-in).
  - `mcp__tmdb_image_search__find_tv(query: string)` — TV series poster (or backdrop).
  - `mcp__tmdb_image_search__find_person(query: string)` — actor/crew headshot.

  Each tool matches the `*_image_search__*` naming convention required by the visual-questions contract. Splitting into three tools (vs. one omnibus `find_subject`) gives Claude clearer signals about when to call which: `Movies` category → `find_movie`, `Actors` category → `find_person`, etc.

- **Tools return multimodal results in data mode** (per the resolution baked into `add-commons-image-search-plugin` Decision 1: MCP `CallToolResult` only supports data-mode image content blocks). Each tool downloads the chosen image bytes from TMDB's image CDN (`https://image.tmdb.org/t/p/<size>/<path>`), base64-encodes them, and returns `{ type: "image", data: "<base64>", mimeType: "image/jpeg" }` (TMDB serves JPEG by default) plus a text content block with `{ source: "tmdb", subjectId, title, imageUrl, license, attribution, format: "data" }`.

- **`subjectId` namespacing**:
  - `tmdb:m-<numericId>` for movies.
  - `tmdb:tv-<numericId>` for TV series.
  - `tmdb:p-<numericId>` for people.

- **License is `"CC BY-NC 4.0"`** per TMDB's attribution policy (non-commercial use with attribution). The visual-questions licensing posture (internal trivia, private Slack workspace, attribution shown on reveal) satisfies this in practice; admins enabling this plugin make the call deliberately.

- **`attribution` is `"Data and images via TMDB (themoviedb.org)"`** — per TMDB's branding guidelines. The plugin SHALL set this literal string on every successful response. The reveal-time attribution context block (already specified by visual-questions) surfaces this verbatim.

- **Free API key required.** Plugin reads the key from `config.plugins.tmdbImageSearch.apiKey` (or `data/auth/tmdb.json`). When the key is unset, every tool call returns `{ kind: "keyMissing" }` — trivia's visual research subflow silently moves on (per the visual-questions contract).

- **Image-size selection**: TMDB's image CDN serves multiple size variants (`w92`, `w185`, `w342`, `w500`, `w780`, `h632`, `original`). The plugin SHALL use `w500` for posters (movie + TV), `h632` for profiles (actors), and `w780` for backdrops — sizes chosen to balance Slack render quality against the 5 MB tool-result cap and the data-mode base64-encoding overhead.

- **Default image kind per tool**: `find_movie` returns the `poster_path` (vertical poster — the canonical "movie image"). `find_tv` returns the `poster_path`. `find_person` returns the `profile_path` (actor headshot). Backdrops/stills are NOT returned by default in v1 — they're reserved for a follow-up if "scene still" trivia becomes a real need.

- **Result selection**: TMDB's search endpoint returns multiple matches per query (one query may match several movies with the same title across years). The plugin SHALL pick the top result by TMDB's relevance ranking (`results[0]`), but SKIP entries with null `poster_path` / `profile_path` until finding one with imagery. If none in the top 10 have imagery, return `{ kind: "notFound" }`.

- **Rate-limit etiquette**: TMDB's free tier limits to ~40 req/sec / ~1M/day. Plugin sets the standard `Authorization: Bearer <api-key>` header (TMDB v4 auth — or `?api_key=<key>` query param for v3, plugin picks one consistently). Surfaces `kind: "rateLimit"` on 429 after one bounded retry.

- **Structured error returns** per the visual-questions contract: `notFound`, `rateLimit`, `network`, `unknown`, `keyMissing`.

- **No persistent storage.** Stateless plugin — every call is two HTTP round-trips (search + image download).

## Capabilities

### New Capabilities

- `tmdb-image-search`: the TMDB MCP tools (one per subject kind), their contract conformance (multimodal data-mode return, structured errors, subjectId namespacing), TMDB-specific image-size selection, mandatory TMDB attribution string, license posture.

### Modified Capabilities

(none)

## Impact

- **Code**: new `src/plugins/tmdb-image-search/` directory with `index.ts` (plugin entry + three tool registrations), `findMovie.ts` / `findTv.ts` / `findPerson.ts` (per-tool implementations), `tmdb.ts` (HTTP adapter to TMDB search endpoints + image-CDN fetcher), and corresponding `.test.ts` files. Plugin loader registration follows the same pattern as the Commons and Brave plugins.
- **External dependencies**: TMDB API (`https://api.themoviedb.org/3/search/...`) for search; TMDB image CDN (`https://image.tmdb.org/t/p/<size>/<path>`) for image downloads. Both HTTPS. Requires admin to sign up at themoviedb.org for a free API key. No new npm packages — built-in `fetch`.
- **Configuration**: optional `config.plugins.tmdbImageSearch.apiKey` (or `data/auth/tmdb.json`). When the key is unset, the plugin loads but its tools return `keyMissing` — trivia falls through to other image-search tools.
- **Tests**: mock the TMDB HTTP layer. Happy path per tool (find_movie / find_tv / find_person each return data-mode image block + text block with `tmdb:m-<id>` / `tmdb:tv-<id>` / `tmdb:p-<id>` subjectIds and the mandatory attribution string). Error paths (keyMissing when key unset, no results, no imagery in top 10, rate-limit retry, 5xx network, oversized image, image CDN failure). License/attribution always populated correctly.
- **User-visible behavior**: with TMDB plugin installed and key configured, visual trivia rounds can cover `Movies`, `TV Series`, and `Actors` categories with high-quality posters and headshots. With TMDB installed but key unset, plugin is a no-op (`keyMissing`), trivia falls through. Without TMDB installed at all, behavior is unchanged.

## Dependencies

This change depends on `add-trivia-visual-questions` defining the external image-search MCP tool contract. It does NOT depend on `add-commons-image-search-plugin` or `add-brave-image-search-plugin` — the three are independent and complementary. Recommended deployment: Commons (canonical subjects) + TMDB (movies/TV/actors) + Brave (long-tail fallback). The image-search ecosystem is additive.

This change also adopts the **data-mode return decision** resolved by `add-commons-image-search-plugin` Decision 1 (URL-mode is not expressible as a typed MCP tool result; all image-search plugins use data-mode). The visual-questions proposal's URL-vs-data flexibility was a wishful early framing — in practice, data-mode is the only path.
