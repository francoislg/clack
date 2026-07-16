# tmdb-image-search Specification

## Purpose
Free-key TMDB MCP tools for visual trivia: `find_movie` / `find_tv` resolve a query to a spoiler-safe **textless backdrop** (never a title-bearing poster) and `find_person` to a profile headshot, returned as data-mode multimodal results with structured errors, `tmdb:m-` / `tmdb:tv-` / `tmdb:p-` subjectId namespacing, Bearer-token auth, and mandatory TMDB attribution/license constants.

## Requirements

### Requirement: Three MCP tools — one per TMDB content kind

The plugin SHALL expose three MCP tools on its always-on default server:

- `find_movie` — searches movies, returns a textless backdrop (scene still).
- `find_tv` — searches TV series, returns a textless backdrop (scene still).
- `find_person` — searches people (actors / crew), returns a profile headshot.

Each tool SHALL accept one required argument `query: string` (non-blank — a whitespace-only query counts as empty — and ≤ 200 characters after trimming; violations SHALL be rejected in-handler with a structured error, never a schema-level throw). Each tool's DESCRIPTION SHALL state its category fit (e.g. `find_movie` → "Best for the Movies category") so trivia's prompt — which discovers image sources by description, not by tool name — routes by the rolled category. Tool names are NOT load-bearing.

#### Scenario: Movies category routes to find_movie

- **GIVEN** trivia's visual research subflow has the rolled category `"Movies"`
- **AND** the TMDB plugin's three tools are present in Claude's tool list
- **WHEN** Claude reads the tool descriptions to pick a tool
- **THEN** Claude calls `find_movie` (not `find_tv` or `find_person`)

#### Scenario: Actors category routes to find_person

- **GIVEN** the rolled category is `"Actors"`
- **WHEN** Claude reads the tool descriptions
- **THEN** Claude calls `find_person`

#### Scenario: Empty query is rejected (per tool)

- **WHEN** any of the three tools is called with `query: ""` (or a whitespace-only string)
- **THEN** the tool returns a structured error indicating the query was empty

#### Scenario: Oversized query is rejected (per tool)

- **WHEN** any of the three tools is called with `query` longer than 200 characters
- **THEN** the tool returns a structured error indicating the query bound was exceeded

### Requirement: Textless backdrops for movies and TV — no poster fallback

`find_movie` and `find_tv` SHALL return a **textless backdrop** (a scene still with no language tag), resolved as follows:

1. Search the relevant endpoint; select a candidate result per the result-selection requirement.
2. GET `/{movie|tv}/{id}/images?include_image_language=null` and read `backdrops[]`.
3. Select the backdrop with the highest `vote_average` (ties broken by array order).
4. If `backdrops[]` is empty but the search result's `backdrop_path` is non-null, use `backdrop_path`.
5. If neither yields a backdrop, treat the candidate as unusable and advance to the next candidate (per the result-selection requirement); if no candidate yields a backdrop, return `{ kind: "notFound" }`.

The tools SHALL NOT return a poster, and SHALL NOT fall back to a poster when no textless backdrop exists — a poster carries the title and would spoil a "guess the title/series" question.

#### Scenario: Movie backdrop selected by highest vote

- **GIVEN** `find_movie("Fight Club")` resolves movie ID 550
- **AND** `/movie/550/images?include_image_language=null` returns backdrops `[{file_path:"/a.jpg",vote_average:5.2},{file_path:"/b.jpg",vote_average:7.8}]`
- **WHEN** the tool selects a backdrop
- **THEN** it uses `/b.jpg` (highest `vote_average`), downloaded from `https://image.tmdb.org/t/p/w780/b.jpg`

#### Scenario: TV series backdrop for "guess the series"

- **GIVEN** `find_tv("Game of Thrones")` resolves TV ID 1399 with a non-empty textless `backdrops[]`
- **WHEN** the tool selects a backdrop
- **THEN** the result is a textless scene still (no language tag), `subjectId: "tmdb:tv-1399"`, image fetched at `w780`

#### Scenario: No textless backdrop — notFound, never a poster

- **GIVEN** a movie whose `/images?include_image_language=null` returns `backdrops: []` and whose search `backdrop_path` is `null`, but which has a non-null `poster_path`
- **WHEN** `find_movie` exhausts its candidate budget
- **THEN** the tool returns `{ kind: "notFound", message: "<descriptive>" }` and NEVER returns the poster

#### Scenario: Empty-backdrops with search backdrop_path fallback

- **GIVEN** `/images?include_image_language=null` returns `backdrops: []` but the search result's `backdrop_path` is `"/c.jpg"`
- **WHEN** the tool resolves the image
- **THEN** it uses `https://image.tmdb.org/t/p/w780/c.jpg`

### Requirement: Profile headshots for people

`find_person` SHALL return the matched person's `profile_path` headshot directly from the search result, with no `/images` hop. It SHALL skip results with a null `profile_path`.

#### Scenario: Null profile_path skipped

- **GIVEN** the top person result has `profile_path: null` and the second result has `profile_path: "/xyz.jpg"`
- **WHEN** `find_person` iterates
- **THEN** the second result is returned; `subjectId` reflects the second result's ID

#### Scenario: Successful person lookup

- **GIVEN** `find_person("Brad Pitt")` matches person ID 287 with a non-null `profile_path: "/xyz.jpg"`
- **WHEN** the tool resolves the image
- **THEN** the result is multimodal with `subjectId: "tmdb:p-287"`, image downloaded from `https://image.tmdb.org/t/p/h632/xyz.jpg`, all contract fields populated

### Requirement: Multimodal data-mode return per the visual-questions contract

On success, each tool SHALL return a multimodal MCP tool result containing:

1. An **image content block** in data mode: `{ "type": "image", "data": "<base64 of the downloaded TMDB CDN image>", "mimeType": "image/<jpeg|png|webp>" }` (MIME detected via `Content-Type`, fallback `image/jpeg`).
2. A **text content block** with JSON metadata: `{ "source": "tmdb", "subjectId": "<namespaced>", "title": "<canonical title>", "imageUrl": "<TMDB CDN URL>", "license": "CC BY-NC 4.0", "attribution": "Data and images via TMDB (themoviedb.org)", "format": "data" }`.

`imageUrl` SHALL be the full TMDB CDN URL of the same image whose bytes are in the data block. The plugin SHALL NOT use URL-mode image content blocks (unsupported by MCP `CallToolResult`).

#### Scenario: Successful movie lookup is multimodal

- **GIVEN** `find_movie("Fight Club")` resolves a textless backdrop `/b.jpg` for movie ID 550 titled "Fight Club"
- **WHEN** the tool returns
- **THEN** the result has a data-mode image block (`type: "image"`, base64 `data` of `https://image.tmdb.org/t/p/w780/b.jpg`, `mimeType: "image/jpeg"`) and a text block with `subjectId: "tmdb:m-550"`, `title: "Fight Club"`, `imageUrl: "https://image.tmdb.org/t/p/w780/b.jpg"`, `license: "CC BY-NC 4.0"`, `attribution: "Data and images via TMDB (themoviedb.org)"`, `format: "data"`

### Requirement: subjectId namespacing by content kind

`subjectId` SHALL be `tmdb:m-<id>` for movies, `tmdb:tv-<id>` for TV series, `tmdb:p-<id>` for people, where `<id>` is TMDB's numeric ID for the matched result. The kind prefix is non-optional — a movie ID and a TV ID with the same number SHALL produce distinct `subjectId` values.

#### Scenario: Movie and TV with same numeric ID are distinct

- **GIVEN** movie ID 1 and TV ID 1 (a contrived overlap)
- **WHEN** `find_movie` and `find_tv` each return their respective ID 1
- **THEN** the `subjectId` values are `"tmdb:m-1"` and `"tmdb:tv-1"` (not equal); `find_previous_subjects` does not confuse them

### Requirement: Fixed image sizes per content kind

The plugin SHALL use these fixed TMDB CDN sizes:

- Movie/TV backdrop: `w780` (`https://image.tmdb.org/t/p/w780/<file_path>`).
- Person profile: `h632` (`https://image.tmdb.org/t/p/h632/<profile_path>`).

The plugin SHALL NOT use `original` and SHALL NOT expose size as a tool argument.

#### Scenario: Backdrop fetched at w780

- **WHEN** `find_movie` or `find_tv` downloads its selected backdrop
- **THEN** the URL uses the `w780` size segment (not `original`, `w300`, etc.)

#### Scenario: Profile fetched at h632

- **WHEN** `find_person` downloads its profile image
- **THEN** the URL uses the `h632` size segment

### Requirement: Result selection — first usable result, bounded candidate budget

Each tool SHALL iterate `results[]` in TMDB rank order, capped at index 10:

- `find_movie` / `find_tv`: attempt the textless-backdrop resolution (per its requirement) on a candidate result. If a candidate yields no backdrop, advance to the next. The plugin SHALL attempt the `/images` hop on at most the first 3 candidate results before giving up; when all 3 yield no backdrop, the tool SHALL return `{ kind: "notFound" }` without evaluating further results (the index-10 cap binds only when the search returns fewer usable candidates).
- `find_person`: skip results with null `profile_path`; the first with a profile wins.

When no usable result is found within the cap/budget, the tool SHALL return `{ kind: "notFound" }`. When the search returns zero results, the tool SHALL return `{ kind: "notFound" }`.

#### Scenario: First candidate has no backdrop — second candidate used

- **GIVEN** the top movie result yields empty `backdrops[]` and null `backdrop_path`, and the 2nd result yields a textless backdrop
- **WHEN** `find_movie` iterates
- **THEN** the 2nd result's backdrop is returned; `subjectId` reflects the 2nd result's ID

#### Scenario: Zero search results — notFound

- **GIVEN** TMDB returns `{ "results": [] }`
- **WHEN** any tool processes the response
- **THEN** it returns `{ kind: "notFound", message: "<descriptive>" }`

### Requirement: keyMissing returned when the token is unset

The plugin SHALL load successfully when no TMDB token is configured. It SHALL read the token from `process.env.TMDB_READ_TOKEN` (set in `data/auth/.env`) and SHALL NOT import core config. When the token is unset/blank, every tool call SHALL return `{ kind: "keyMissing", message: "<message naming TMDB_READ_TOKEN / data/auth/.env>" }` without making any HTTP request. The plugin SHALL NOT throw, fail to load, or log errors when the token is unset.

#### Scenario: No token — keyMissing returned

- **GIVEN** `process.env.TMDB_READ_TOKEN` is unset
- **WHEN** any of the three tools is called
- **THEN** the tool returns `{ kind: "keyMissing", message: "<descriptive>" }` without any HTTP request

#### Scenario: Plugin loads without token

- **GIVEN** no token is configured at boot
- **WHEN** the plugin loads
- **THEN** the plugin loads successfully; all three tools register; subsequent calls return `keyMissing`

### Requirement: TMDB attribution and license constants on every success

The plugin SHALL emit `license: "CC BY-NC 4.0"` and `attribution: "Data and images via TMDB (themoviedb.org)"` as literal constants on every successful tool result, not derived from per-result metadata.

#### Scenario: Constants on every success

- **WHEN** any tool returns successfully
- **THEN** `license` is exactly `"CC BY-NC 4.0"` AND `attribution` is exactly `"Data and images via TMDB (themoviedb.org)"`

### Requirement: Authentication via Bearer token

The plugin SHALL authenticate with TMDB using `Authorization: Bearer <token>` (the v4 read access token) on every search, `/images`, and CDN request. The plugin SHALL NOT use the `?api_key=<key>` query-param style.

#### Scenario: Bearer header set

- **WHEN** the plugin issues any TMDB request
- **THEN** the request includes the `Authorization: Bearer <token>` header (not `?api_key=` in the URL)

### Requirement: Structured error returns on failure

The plugin SHALL return a structured error (matching the visual-questions `SourceError` shape) on every failure mode and SHALL NOT throw out of any tool call:

- `keyMissing` — token unset.
- `notFound` — zero results, no usable image within the cap/budget, or a blank/oversized query.
- `rateLimit` — 429 on initial and on one bounded retry.
- `network` — 5xx (after one retry), timeout, connection failure, or a CDN download failure.
- `tooLarge` — downloaded image exceeds the 5 MB cap.
- `unsupportedFormat` — the CDN returns an SVG or a non-image Content-Type.
- `unknown` — 200 with valid JSON but a missing/malformed `results` (or `backdrops`) field.

"Bounded retry" means exactly one retry per failed request (429 → one ~1s jittered retry; 5xx → one ~500ms jittered retry). Timeouts and connection failures are not retried.

#### Scenario: 429 retry exhaustion — rateLimit

- **GIVEN** TMDB returns 429 on initial and on retry
- **THEN** the tool returns `{ kind: "rateLimit", message: "<descriptive>" }`

#### Scenario: 5xx — network

- **GIVEN** TMDB returns 500 on initial and on retry
- **THEN** the tool returns `{ kind: "network", message: "<descriptive>" }`

#### Scenario: Timeout — network

- **GIVEN** a TMDB request exceeds the 5s timeout
- **THEN** the tool returns `{ kind: "network", message: "<descriptive>" }` without retrying

#### Scenario: Image CDN download fails

- **GIVEN** search + `/images` succeed but the CDN download for the selected backdrop returns 404
- **THEN** the tool returns `{ kind: "network", message: "<descriptive CDN failure>" }`

#### Scenario: Oversized image — tooLarge

- **GIVEN** the CDN returns an image whose bytes exceed the 5 MB cap
- **THEN** the tool returns `{ kind: "tooLarge", message: "<descriptive>" }`

#### Scenario: Malformed search response — unknown

- **GIVEN** TMDB returns 200 with valid JSON but missing the `results` field
- **THEN** the tool returns `{ kind: "unknown", message: "<descriptive>" }`

### Requirement: Stateless plugin — no caching

The plugin SHALL NOT cache responses, in memory or on disk. Each tool call SHALL perform fresh HTTP requests (search → `/images` → CDN for movies/TV; search → CDN for people).

#### Scenario: Repeated calls hit upstream fresh

- **GIVEN** the same query is sent to `find_movie` twice within one trivia run
- **WHEN** the plugin processes each call
- **THEN** both perform full HTTP round-trips; no plugin-side cache
