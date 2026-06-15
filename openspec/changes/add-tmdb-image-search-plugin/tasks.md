## 1. Plugin scaffold

- [ ] 1.1 Create the plugin directory `src/plugins/tmdb-image-search/` with `index.ts` (plugin entry + three tool registrations), `findMovie.ts`, `findTv.ts`, `findPerson.ts` (per-tool implementations), `tmdb.ts` (HTTP adapter), and matching `.test.ts` files. Follow the existing plugin layout pattern from `src/plugins/commons-image-search/` (which has already implemented the data-mode return contract).
- [ ] 1.2 Register the plugin in the project's plugin-loader entry, using the same registration pattern as Commons. Confirm the plugin's MCP server name produces tool names of the form `mcp__tmdb_image_search__find_movie` (and `find_tv`, `find_person`).
- [ ] 1.3 Confirm the plugin loads cleanly at boot whether or not the TMDB API key is configured (no startup errors, no warnings).

## 2. Configuration plumbing

- [ ] 2.1 Add `config.plugins.tmdbImageSearch.apiKey?: string` to `src/config.ts` `Config` type. Verify the existing secret-config pattern by reading how other plugin secrets are routed (likely `data/auth/tmdb.json`); match that pattern.
- [ ] 2.2 Implement a helper `loadTmdbApiKey(): string | null` that reads the configured location and returns `null` when unset. Surface the resolved path in the `keyMissing` error message so admins know where to put the key.
- [ ] 2.3 Tests: key present in config → returned correctly; key absent → `null`; both config and `data/auth/tmdb.json` present → document precedence (recommend: explicit config > data/auth file) and test both.

## 3. TMDB search adapter

- [ ] 3.1 In `tmdb.ts`, implement `searchMovies(query: string, token: string)`: GET `https://api.themoviedb.org/3/search/movie?query=<URL-encoded query>&language=en-US&include_adult=false`. Set headers `Authorization: Bearer <token>`, `Accept: application/json`. Timeout 5 seconds.
- [ ] 3.2 Implement `searchTv(query, token)` and `searchPerson(query, token)` analogously, hitting `/search/tv` and `/search/person`.
- [ ] 3.3 Implement bounded retry-with-backoff: on 429, retry once with 1-second jittered backoff; if still 429 → `{ kind: "rateLimit", message }`. On 5xx, retry once with 500ms jittered backoff; if still 5xx → `{ kind: "network", message }`. Timeout / connection failure → `{ kind: "network", message }`.
- [ ] 3.4 Treat 200 with no `results` array or empty `results: []` as `{ kind: "notFound" }`. Treat 200 with malformed JSON as `{ kind: "unknown" }`.
- [ ] 3.5 Tests for each search endpoint: happy path; 429 → retry → 200; 429 → retry → 429 → `rateLimit`; 5xx → retry → `network`; timeout → `network`; empty results → `notFound`; missing `results` field → `unknown`. Verify the `Authorization: Bearer` header is set on every outbound request.

## 4. TMDB image-CDN downloader

- [ ] 4.1 In `tmdb.ts`, implement `fetchImageBytes(cdnUrl: string)`: download the image from `https://image.tmdb.org/t/p/<size>/<path>`. Set `Accept: image/*`. Timeout 5 seconds. Detect MIME type from the response's `Content-Type` header; fall back to `image/jpeg` if missing or malformed. Enforce 5 MB raw-bytes cap before base64 encoding (since base64 grows ~33%, 5 MB raw → ~6.7 MB encoded; verify Slack's `hero_image` / MCP tool-result limit isn't tighter — adjust cap if needed).
- [ ] 4.2 Return `{ ok: true, base64, mimeType }` on success, or structured errors:
  - 404 / 4xx → `{ kind: "network", message }` (CDN miss is rare but treated as network-class failure)
  - 5xx with one retry → `{ kind: "network", message }` if still failing
  - Oversized payload → `{ kind: "tooLarge", message }`
  - Non-image Content-Type (e.g., `text/html` from an error page) → `{ kind: "unknown", message }`
- [ ] 4.3 Tests: happy path returns base64 + mimeType; CDN 404 → `network`; oversized → `tooLarge`; HTML Content-Type → `unknown`.

## 5. find_movie tool implementation

- [ ] 5.1 In `findMovie.ts`, define the MCP tool `find_movie` with Zod schema `{ query: z.string().min(1).max(200) }`. Reject empty/oversized queries inline with a structured error.
- [ ] 5.2 Tool logic:
  1. Resolve the API key via `loadTmdbApiKey()`. If `null` → return `{ kind: "keyMissing", message: "<path>" }`.
  2. Call `searchMovies(args.query, key)`. If error → return that error.
  3. Iterate `results[]` in order, up to index 10. Skip entries where `poster_path` is null. Find the first result with a non-null `poster_path`. If none → return `{ kind: "notFound", message: "no result with poster in top 10" }`.
  4. Build the image CDN URL: `https://image.tmdb.org/t/p/w500${selectedResult.poster_path}`.
  5. Call `fetchImageBytes(cdnUrl)`. If error → return that error (network / tooLarge / unknown).
  6. Build subjectId: `"tmdb:m-" + selectedResult.id`.
  7. Build title: `selectedResult.title` (movies use `title`, not `name`).
  8. Build metadata block: `{ source: "tmdb", subjectId, title, imageUrl: cdnUrl, license: "CC BY-NC 4.0", attribution: "Data and images via TMDB (themoviedb.org)", format: "data" }`.
- [ ] 5.3 Compose the multimodal tool result: data-mode image content block + text content block with the metadata JSON. Use the SDK helper (existing `imageAndTextResult` from the Commons plugin or equivalent).
- [ ] 5.4 Tests:
  - Successful lookup → all fields correct, `subjectId: "tmdb:m-<id>"`
  - First result has null `poster_path`, second has a poster → second selected
  - All top-10 results have null `poster_path` → `notFound`
  - Empty results → `notFound`
  - Key missing → `keyMissing` without HTTP request
  - Search-side errors propagate correctly
  - CDN-download error propagates correctly
  - Attribution and license constants always set

## 6. find_tv tool implementation

- [ ] 6.1 In `findTv.ts`, define the MCP tool `find_tv` with the same Zod schema as `find_movie`.
- [ ] 6.2 Tool logic mirrors `find_movie` with the following differences:
  - Search via `searchTv(query, key)`.
  - Title field is `result.name` (TV uses `name`, not `title`).
  - subjectId prefix is `"tmdb:tv-"`.
  - Image CDN URL uses `w500` (same as movies; TV posters and movie posters are both vertical).
- [ ] 6.3 Tests: same shape as `find_movie` tests, adjusted for TV-specific fields. Verify `subjectId` prefix is `"tmdb:tv-"` and title comes from `result.name`.

## 7. find_person tool implementation

- [ ] 7.1 In `findPerson.ts`, define the MCP tool `find_person` with the same Zod schema.
- [ ] 7.2 Tool logic mirrors `find_movie` with the following differences:
  - Search via `searchPerson(query, key)`.
  - Title field is `result.name`.
  - subjectId prefix is `"tmdb:p-"`.
  - Image CDN URL uses `h632` (portrait-oriented for headshots): `https://image.tmdb.org/t/p/h632${selectedResult.profile_path}`.
  - Skip entries where `profile_path` is null (not `poster_path`).
- [ ] 7.3 Tests: same shape as `find_movie` tests, adjusted for person-specific fields. Verify the CDN URL uses `h632` and the skip condition is on `profile_path`.

## 8. Plugin registration

- [ ] 8.1 In `src/plugins/tmdb-image-search/index.ts`, register all three tools with the MCP server. Verify the resulting tool names are `mcp__tmdb_image_search__find_movie`, `mcp__tmdb_image_search__find_tv`, `mcp__tmdb_image_search__find_person`.
- [ ] 8.2 Configure as always-on / autoload (no `attach_integration` step).
- [ ] 8.3 Write per-tool descriptions emphasizing the category fit:
  - `find_movie`: "TMDB movie poster lookup. Best for the 'Movies' category. Searches The Movie Database for a movie by title and returns its canonical poster image. Pass the movie's title (with disambiguation year if relevant, e.g., 'Dune 2021') as `query`."
  - `find_tv`: "TMDB TV series poster lookup. Best for the 'TV Series' category. Searches The Movie Database for a TV series by name and returns its canonical poster image. Pass the series name (with year if relevant) as `query`."
  - `find_person`: "TMDB person profile lookup. Best for the 'Actors' category (also actresses, filmmakers, crew). Searches The Movie Database for a person by name and returns their canonical profile photo. Pass the person's full name as `query`."

## 9. Documentation

- [ ] 9.1 Add a plugin README at `src/plugins/tmdb-image-search/README.md` covering:
  - What this plugin is for (movies, TV, actors — the central pop-culture trivia categories)
  - How to obtain the free TMDB API key (link to https://www.themoviedb.org/signup → Settings → API)
  - The distinction between the v3 API key and the v4 read access token — use the v4 read access token
  - Where to put the key (config path or `data/auth/tmdb.json`)
  - TMDB's attribution requirement and how this plugin satisfies it (constant attribution string on every reveal)
  - The CC BY-NC 4.0 licensing posture (non-commercial; internal trivia / private Slack workspace satisfies this)
  - Free-tier limits (~40 req/sec, ~1M req/day) and rate-limit handling
- [ ] 9.2 Update `CLAUDE.md` (or admin-facing doc) to list `tmdb-image-search` alongside Commons and Brave as part of the recommended visual-trivia image-search plugin stack.

## 10. Integration smoke test

- [ ] 10.1 With `add-trivia-visual-questions`, `add-commons-image-search-plugin`, and this plugin all installed (and TMDB key configured), trigger a scheduled trivia run with `promptMedium: { text: 0, image: 1 }` for category `"Movies"`. Verify Claude calls `mcp__tmdb_image_search__find_movie`, receives the data-mode multimodal result, inspects the poster, writes a question, saves with `media.source: "tmdb"` and `media.subjectId: "tmdb:m-<id>"`, posts to Slack with the poster rendered via the file-upload hop.
- [ ] 10.2 Repeat for category `"TV Series"` → `find_tv` is called.
- [ ] 10.3 Repeat for category `"Actors"` → `find_person` is called.
- [ ] 10.4 Verify the reveal renders `📷 Image: Data and images via TMDB (themoviedb.org) · CC BY-NC 4.0`.
- [ ] 10.5 Test the keyMissing path: with the TMDB key temporarily removed, a `"Movies"` run falls through to another image-search tool (if Brave or Commons is installed) or to text. No errors surface.
- [ ] 10.6 Test the no-imagery path: simulate a TMDB result with `poster_path: null` (or query a real obscure title with no poster) → verify the tool falls through to the next result or returns `notFound` gracefully.

## 11. Validation and acceptance

- [ ] 11.1 Run `openspec validate add-tmdb-image-search-plugin --strict` and resolve any spec-coherence issues
- [ ] 11.2 Run `npm test` — verify all new tests pass
- [ ] 11.3 Run `npx tsc` (type-check) and `npx oxlint src/plugins/tmdb-image-search` (lint) — no errors
- [ ] 11.4 Run `npx oxfmt src/plugins/tmdb-image-search` to format
