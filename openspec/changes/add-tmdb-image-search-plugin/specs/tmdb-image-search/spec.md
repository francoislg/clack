## ADDED Requirements

### Requirement: Three MCP tools — one per TMDB content kind

The plugin SHALL expose three separate MCP tools, each conforming to the `*_image_search__*` naming convention required by the trivia visual-questions contract:

- `mcp__tmdb_image_search__find_movie` — searches movies, returns poster.
- `mcp__tmdb_image_search__find_tv` — searches TV series, returns poster.
- `mcp__tmdb_image_search__find_person` — searches people (actors / crew), returns profile photo.

Each tool SHALL accept one required argument `query: string` (non-empty, ≤ 200 characters; longer queries SHALL be rejected with a structured error). Each tool's description SHALL state its category fit (e.g., `find_movie` → "Best for Movies category") so trivia's prompt can match by category.

#### Scenario: Movies category routes to find_movie

- **GIVEN** trivia's visual research subflow has the rolled category `"Movies"`
- **AND** the TMDB plugin's three tools are present in Claude's tool list
- **WHEN** Claude reads the tool descriptions to pick a tool
- **THEN** Claude calls `mcp__tmdb_image_search__find_movie` (not `find_tv` or `find_person`)

#### Scenario: Actors category routes to find_person

- **GIVEN** the rolled category is `"Actors"`
- **WHEN** Claude reads the tool descriptions
- **THEN** Claude calls `mcp__tmdb_image_search__find_person`

#### Scenario: Empty query is rejected (per tool)

- **WHEN** any of the three tools is called with `query: ""`
- **THEN** the tool returns a structured error indicating the query was empty

#### Scenario: Oversized query is rejected (per tool)

- **WHEN** any of the three tools is called with `query` longer than 200 characters
- **THEN** the tool returns a structured error indicating the query bound was exceeded

### Requirement: Multimodal data-mode return per the visual-questions contract

On success, each tool SHALL return a multimodal MCP tool result containing:

1. An **image content block** in data mode: `{ "type": "image", "data": "<base64 of the downloaded TMDB CDN image>", "mimeType": "image/jpeg" }` (TMDB serves JPEG by default; the plugin SHALL detect MIME type via Content-Type and fall back to `image/jpeg` when missing).
2. A **text content block** carrying JSON metadata: `{ "source": "tmdb", "subjectId": "<namespaced>", "title": "<canonical title>", "imageUrl": "<TMDB CDN URL>", "license": "CC BY-NC 4.0", "attribution": "Data and images via TMDB (themoviedb.org)", "format": "data" }`.

`imageUrl` SHALL be the full TMDB CDN URL (`https://image.tmdb.org/t/p/<size>/<path>`) of the same image whose bytes are in the data block. Trivia's `post_questions` Slack file-upload hop re-fetches this URL at post time.

The plugin SHALL NOT use URL-mode image content blocks (MCP `CallToolResult` does not support them — same constraint as Commons and Brave plugins).

#### Scenario: Successful movie lookup

- **GIVEN** the query `"Fight Club"` matches TMDB movie ID 550 with a non-null `poster_path: "/abc.jpg"`
- **WHEN** `find_movie` is called with `query: "Fight Club"`
- **THEN** the result is multimodal: a data-mode image content block (`type: "image"`, base64 `data` of the downloaded `https://image.tmdb.org/t/p/w500/abc.jpg`, `mimeType: "image/jpeg"`); a text content block with `subjectId: "tmdb:m-550"`, `title: "Fight Club"`, `imageUrl: "https://image.tmdb.org/t/p/w500/abc.jpg"`, `license: "CC BY-NC 4.0"`, `attribution: "Data and images via TMDB (themoviedb.org)"`, `format: "data"`

#### Scenario: Successful TV series lookup

- **GIVEN** the query `"Game of Thrones"` matches TMDB TV ID 1399 with a non-null `poster_path`
- **WHEN** `find_tv` is called
- **THEN** the result is multimodal with `subjectId: "tmdb:tv-1399"`, all other contract fields populated correctly

#### Scenario: Successful person lookup

- **GIVEN** the query `"Brad Pitt"` matches TMDB person ID 287 with a non-null `profile_path`
- **WHEN** `find_person` is called
- **THEN** the result is multimodal with `subjectId: "tmdb:p-287"`, image downloaded from `https://image.tmdb.org/t/p/h632/...`, all other contract fields correct

### Requirement: subjectId namespacing by content kind

`subjectId` SHALL be `tmdb:m-<id>` for movies, `tmdb:tv-<id>` for TV series, `tmdb:p-<id>` for people. The `<id>` is TMDB's numeric ID for the matched result.

The kind prefix is non-optional — a movie ID and a TV ID that happen to be the same number SHALL produce distinct `subjectId` values (`tmdb:m-1` and `tmdb:tv-1` never match).

#### Scenario: Movie and TV with same numeric ID are distinct

- **GIVEN** TMDB has movie ID 1 and TV ID 1 (a contrived overlap)
- **WHEN** both `find_movie` and `find_tv` return results with their respective ID 1
- **THEN** the saved `subjectId` values are `"tmdb:m-1"` and `"tmdb:tv-1"` (not equal); trivia's `find_previous_subjects` does NOT confuse them

### Requirement: Fixed image sizes per content kind

The plugin SHALL use these fixed TMDB CDN image sizes:

- Movie poster: `w500` (path: `https://image.tmdb.org/t/p/w500/<poster_path>`).
- TV poster: `w500`.
- Person profile: `h632` (path: `https://image.tmdb.org/t/p/h632/<profile_path>`).

The plugin SHALL NOT use `original` (oversized; risks exceeding the 5 MB base64-encoded cap). The plugin SHALL NOT expose size as a tool argument in v1.

#### Scenario: Movie image is fetched at w500

- **GIVEN** TMDB returns a movie with `poster_path: "/abc.jpg"`
- **WHEN** `find_movie` downloads the image
- **THEN** the URL used is `https://image.tmdb.org/t/p/w500/abc.jpg` (not `original`, not `w185`, not `w780`)

#### Scenario: Person image is fetched at h632

- **GIVEN** TMDB returns a person with `profile_path: "/xyz.jpg"`
- **WHEN** `find_person` downloads the image
- **THEN** the URL used is `https://image.tmdb.org/t/p/h632/xyz.jpg`

### Requirement: Result selection — first result with imagery, top-10 cap

Each tool SHALL iterate TMDB's `results` array in rank order, skipping entries where the relevant image field is null:

- `find_movie` and `find_tv` skip entries with `poster_path: null`.
- `find_person` skips entries with `profile_path: null`.

Iteration SHALL stop at index 10. When no result in the top 10 has the relevant imagery, the tool SHALL return `{ kind: "notFound" }`.

#### Scenario: First result lacks poster — second result selected

- **GIVEN** TMDB's top result has `poster_path: null` and the 2nd result has `poster_path: "/abc.jpg"`
- **WHEN** `find_movie` iterates
- **THEN** the 2nd result is selected; the returned `subjectId` is the 2nd result's TMDB ID

#### Scenario: All top-10 results lack imagery — notFound

- **GIVEN** the top 10 movie results all have `poster_path: null`
- **WHEN** `find_movie` iterates
- **THEN** the tool returns `{ kind: "notFound", message: "<descriptive>" }`

#### Scenario: TMDB returns zero results — notFound

- **GIVEN** TMDB returns `{ "results": [] }` for the query
- **WHEN** the tool processes the response
- **THEN** the tool returns `{ kind: "notFound", message: "<descriptive>" }`

### Requirement: keyMissing returned when API key is unset

The plugin SHALL load successfully even when no TMDB API key is configured. All three tools' calls SHALL return `{ kind: "keyMissing", message: "<descriptive message identifying the missing config path>" }` on every invocation until a key is added.

The plugin SHALL NOT throw, fail to load, or log errors when the key is unset.

#### Scenario: No key — keyMissing returned

- **GIVEN** `config.plugins.tmdbImageSearch.apiKey` and `data/auth/tmdb.json` are both absent
- **WHEN** any of the three tools is called
- **THEN** the tool returns `{ kind: "keyMissing", message: "<descriptive>" }` without making any HTTP requests

#### Scenario: Plugin loads without key

- **GIVEN** no TMDB API key is configured at boot
- **WHEN** the plugin loads
- **THEN** the plugin loads successfully; all three tools register in the MCP server; subsequent calls return `keyMissing`

### Requirement: TMDB attribution constant on every successful response

The plugin SHALL emit `license: "CC BY-NC 4.0"` and `attribution: "Data and images via TMDB (themoviedb.org)"` as literal constants on every successful tool result. The plugin SHALL NOT derive these from per-result metadata (TMDB does not surface per-result licensing).

#### Scenario: Attribution constant on every success

- **GIVEN** any of the three tools returns successfully
- **WHEN** the metadata block is assembled
- **THEN** `license` is exactly the string `"CC BY-NC 4.0"` AND `attribution` is exactly `"Data and images via TMDB (themoviedb.org)"` (no per-result variation)

### Requirement: Authentication via Bearer token

The plugin SHALL authenticate with TMDB using the `Authorization: Bearer <api-key>` header (TMDB v4 read access token style) on every search and image-CDN request. The plugin SHALL NOT use the `?api_key=<key>` query-param style.

#### Scenario: Bearer header set

- **WHEN** the plugin issues a TMDB search request
- **THEN** the request includes `Authorization: Bearer <api-key>` header (not `?api_key=<key>` in the URL)

### Requirement: Structured error returns on failure

The plugin SHALL return a structured error result (matching the visual-questions contract's `SourceError` shape) on every failure mode:

- `kind: "keyMissing"` — API key is unset (see prior requirement).
- `kind: "notFound"` — TMDB returns zero results, OR no result in the top 10 has imagery.
- `kind: "rateLimit"` — TMDB returns 429, and one bounded retry also returns 429.
- `kind: "network"` — TMDB returns 5xx (with one retry), times out, or connection fails; OR the TMDB image CDN download fails.
- `kind: "unknown"` — TMDB returns 200 with valid JSON but the `results` array is missing or malformed.

The plugin SHALL NOT throw exceptions out of any tool call.

#### Scenario: 429 retry exhaustion — rateLimit

- **GIVEN** TMDB returns 429 on initial and 429 on retry
- **WHEN** the plugin processes the responses
- **THEN** the tool returns `{ kind: "rateLimit", message: "<descriptive>" }`

#### Scenario: 5xx error — network

- **GIVEN** TMDB returns 500 on initial and 500 on retry
- **WHEN** the plugin processes the responses
- **THEN** the tool returns `{ kind: "network", message: "<descriptive>" }`

#### Scenario: Image CDN download fails

- **GIVEN** TMDB's search returns successfully with a `poster_path`, but the CDN download for that path returns 404
- **WHEN** the plugin attempts to fetch image bytes
- **THEN** the tool returns `{ kind: "network", message: "<descriptive image CDN failure>" }`

#### Scenario: Oversized image — unsupportedFormat

- **GIVEN** the TMDB CDN returns an image whose base64-encoded size would exceed 5 MB
- **WHEN** the plugin checks the downloaded size
- **THEN** the tool returns `{ kind: "tooLarge", message: "<descriptive>" }` (extremely rare at `w500` / `h632` sizes)

#### Scenario: Malformed search response — unknown

- **GIVEN** TMDB returns 200 with valid JSON but missing the `results` field
- **WHEN** the plugin processes the response
- **THEN** the tool returns `{ kind: "unknown", message: "<descriptive>" }`

### Requirement: Stateless plugin — no caching

The plugin SHALL NOT cache responses, in memory or on disk. Each tool call SHALL perform fresh HTTP requests to TMDB's search endpoint and the image CDN.

#### Scenario: Repeated calls hit upstream fresh

- **GIVEN** the same query is sent to `find_movie` twice within a single trivia run
- **WHEN** the plugin processes each call
- **THEN** both calls perform full HTTP round-trips to TMDB (search + image CDN); no plugin-side cache
