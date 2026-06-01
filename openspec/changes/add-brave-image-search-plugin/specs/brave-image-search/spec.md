## ADDED Requirements

### Requirement: Brave image-search MCP tool conforms to the visual-questions external contract

The plugin SHALL expose a single MCP tool named `mcp__brave_image_search__find_image` (matching the `*_image_search__*` naming convention required by the trivia visual-questions contract). The tool SHALL accept one required argument `query: string` (non-empty, ≤ 200 characters; longer queries SHALL be rejected with a structured error).

On success the tool SHALL return a multimodal MCP tool result containing:

1. An **image content block** in data mode: `{ "type": "image", "data": "<base64 of the downloaded image bytes>", "mimeType": "<image/...>" }`. The MCP `CallToolResult` content type only supports data-mode image blocks; URL-source blocks are not expressible as a tool result, so the plugin downloads the chosen image and base64-encodes it.
2. A **text content block** carrying JSON metadata: `{ "source": "brave", "subjectId": "brave:<sha256-hash-prefix>", "title": "<Brave result title>", "imageUrl": "<top result's image URL>", "license": "unknown", "attribution": "via <source-domain>", "format": "data" }`.

#### Scenario: Successful image lookup

- **GIVEN** Brave Search returns a result list with at least one JPEG/PNG/WebP/GIF image whose source page is `https://example.com/path`
- **WHEN** the tool is called with a non-empty `query` and the API key is configured
- **THEN** the result is multimodal: a data-mode image content block (`type: "image"` with base64 `data` and a `mimeType`); a text content block with `source: "brave"`, `subjectId` of the form `"brave:<12-hex-chars>"`, `imageUrl` set to the chosen image URL, `license: "unknown"`, `attribution: "via example.com"`, `format: "data"`

#### Scenario: Empty query is rejected

- **WHEN** the tool is called with `query: ""`
- **THEN** the tool returns a structured error indicating the query was empty

#### Scenario: Oversized query is rejected

- **WHEN** the tool is called with `query` longer than 200 characters
- **THEN** the tool returns a structured error indicating the query bound was exceeded

### Requirement: subjectId is a deterministic SHA-256 hash of the image URL

The plugin SHALL derive `subjectId` from the chosen image URL via SHA-256, taking the first 12 hexadecimal characters of the hash and prefixing with `"brave:"`. The same image URL SHALL produce the same subjectId on every call (deterministic).

#### Scenario: Same image URL yields same subjectId

- **GIVEN** two separate calls produce the same chosen image URL (e.g., `https://cdn.example.com/abc.jpg`)
- **WHEN** the plugin computes `subjectId` for each
- **THEN** both calls return the same `subjectId: "brave:<12-hex-chars>"`

#### Scenario: Different image URLs yield different subjectIds

- **GIVEN** two calls produce different chosen image URLs
- **WHEN** the plugin computes `subjectId` for each
- **THEN** the resulting subjectIds differ (collision probability is negligible at 48 bits)

### Requirement: License is always "unknown"; attribution derived from source-page domain

The plugin SHALL set `license: "unknown"` (literal string) on every successful response. Brave Search results do not include licensing metadata, and the plugin SHALL NOT attempt to infer license from the source page.

The plugin SHALL derive `attribution` from the source page URL's host:

- When `new URL(result.source).host` succeeds and returns a non-empty string, use `attribution: "via <host>"` (e.g., `"via en.wikipedia.org"`, `"via imdb.com"`).
- When the source URL cannot be parsed (malformed URL), fall back to `attribution: "via Brave Search"`.

#### Scenario: Attribution from valid source domain

- **GIVEN** Brave returns a chosen result whose `source` field is `https://en.wikipedia.org/wiki/Foo`
- **WHEN** the plugin builds the metadata block
- **THEN** `attribution` is `"via en.wikipedia.org"`

#### Scenario: Attribution fallback for malformed source URL

- **GIVEN** Brave returns a chosen result whose `source` field is malformed or missing
- **WHEN** the plugin attempts to derive the host
- **THEN** `attribution` is `"via Brave Search"`

### Requirement: Result filtering — JPEG/PNG/WebP/GIF only, top-10 cap

The plugin SHALL iterate through Brave's `results[]` array in rank order and select the first result whose image URL has a renderable extension (`.jpg`, `.jpeg`, `.png`, `.webp`, `.gif` — case-insensitive). The plugin SHALL NOT consider results past index 10 in the result list.

When no result in the top 10 has a renderable extension, the plugin SHALL return `{ kind: "notFound" }`.

#### Scenario: SVG result skipped, JPEG selected

- **GIVEN** Brave returns results where the top result is an SVG and the 2nd result is a JPEG
- **WHEN** the plugin iterates
- **THEN** the SVG is skipped and the JPEG is selected

#### Scenario: All top-10 results unsupported — notFound

- **GIVEN** the top 10 Brave results all have non-renderable extensions (SVG, BMP, TIFF, etc.) or no extension
- **WHEN** the plugin iterates
- **THEN** the tool returns `{ kind: "notFound", message: "no renderable image in top 10 results" }`

### Requirement: keyMissing returned when API key is unset

The plugin SHALL load successfully even when no Brave API key is configured. The `find_image` tool call SHALL return `{ kind: "keyMissing", message: "<descriptive message identifying the missing config path>" }` on every invocation until a key is added.

The plugin SHALL NOT throw, fail to load, or log errors when the key is unset — `keyMissing` is the documented signal that lets trivia's visual research subflow silently move on.

#### Scenario: No key — keyMissing returned

- **GIVEN** `BRAVE_API_KEY` is absent from the environment (`data/auth/.env`)
- **WHEN** the tool is called
- **THEN** the tool returns `{ kind: "keyMissing", message: "<descriptive>" }` without making any HTTP requests

#### Scenario: Plugin loads without key

- **GIVEN** no Brave API key is configured at boot
- **WHEN** the plugin loads
- **THEN** the plugin loads successfully; the tool registers in the MCP server; subsequent calls return `keyMissing`

### Requirement: Structured error returns on failure

The plugin SHALL return a structured error result (matching the visual-questions contract's `SourceError` shape) on every failure mode:

- `kind: "keyMissing"` — API key is unset (see prior requirement).
- `kind: "notFound"` — Brave returns zero results, OR no result in the top 10 has a renderable extension (see prior requirement).
- `kind: "rateLimit"` — Brave returns 429, and one bounded retry also returns 429.
- `kind: "network"` — Brave returns 5xx (with one retry), times out, or connection fails.
- `kind: "unknown"` — Brave returns 200 with valid JSON but the `results` array is missing or malformed.

The plugin SHALL NOT throw exceptions out of the tool call.

#### Scenario: 429 on initial and retry — rateLimit

- **GIVEN** Brave returns 429 on the initial request and 429 on the retry
- **WHEN** the plugin processes the responses
- **THEN** the tool returns `{ kind: "rateLimit", message: "<descriptive, including upstream status>" }`

#### Scenario: 429 then 200 — successful retry

- **GIVEN** Brave returns 429 once, then 200 on retry with valid results
- **WHEN** the plugin processes the second response
- **THEN** the tool returns the successful multimodal result

#### Scenario: 5xx error — network

- **GIVEN** Brave returns 500 on initial and 500 on retry
- **WHEN** the plugin processes the responses
- **THEN** the tool returns `{ kind: "network", message: "<descriptive>" }`

#### Scenario: Timeout — network

- **GIVEN** the Brave Search request does not complete within 5 seconds
- **WHEN** the timeout fires
- **THEN** the tool returns `{ kind: "network", message: "<timeout message>" }`

#### Scenario: Empty results — notFound

- **GIVEN** Brave returns 200 with `{ "results": [] }`
- **WHEN** the plugin processes the response
- **THEN** the tool returns `{ kind: "notFound", message: "<descriptive>" }`

#### Scenario: Malformed response — unknown

- **GIVEN** Brave returns 200 with valid JSON but no `results` field
- **WHEN** the plugin processes the response
- **THEN** the tool returns `{ kind: "unknown", message: "<descriptive>" }`

### Requirement: Authentication and rate-limit headers

The plugin SHALL include the following headers on every outbound request to Brave:

- `X-Subscription-Token: <api-key>` (the Brave free-tier authentication header).
- `Accept: application/json`.
- A descriptive `User-Agent` identifying the bot/project (e.g., `Clack-Trivia-Image-Search/1.0`).

The plugin SHALL implement bounded retry-with-backoff: one retry with 1-second jittered backoff on 429, one retry with 500ms jittered backoff on 5xx. Timeout per HTTP call SHALL be 5 seconds.

#### Scenario: Headers set on outbound request

- **WHEN** the plugin issues a Brave Search request
- **THEN** the request includes `X-Subscription-Token`, `Accept: application/json`, and a descriptive `User-Agent`

### Requirement: Stateless plugin — no caching

The plugin SHALL NOT cache responses, in memory or on disk. Each `find_image` call SHALL perform a fresh HTTP request to Brave Search.

#### Scenario: Repeated calls hit upstream fresh

- **GIVEN** the same query is sent twice within a single trivia run
- **WHEN** the plugin processes each call
- **THEN** both calls perform full HTTP round-trips to Brave (no plugin-side cache)
