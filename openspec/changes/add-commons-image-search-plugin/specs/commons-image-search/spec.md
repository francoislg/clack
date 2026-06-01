## ADDED Requirements

### Requirement: Commons image-search MCP tool conforms to the visual-questions external contract

The plugin SHALL expose a single MCP tool named `mcp__commons_image_search__find_subject` (matching the `*_image_search__*` naming convention required by the trivia visual-questions contract). The tool SHALL accept one required argument `query: string` (non-empty, ≤ 200 characters; longer queries SHALL be rejected with a structured error).

On success the tool SHALL return a multimodal MCP tool result containing:

1. An **image content block** in data mode: `{ "type": "image", "data": "<base64 of the downloaded thumbnail.source bytes>", "mimeType": "<image/...>" }`. The MCP `CallToolResult` content type only supports data-mode image blocks; URL-source blocks are not expressible as a tool result, so the plugin downloads the thumbnail and base64-encodes it.
2. A **text content block** carrying JSON metadata: `{ "source": "commons", "subjectId": "<namespaced-id>", "title": "<canonical title>", "imageUrl": "<thumbnail.source URL>", "license": "<license string or 'unknown'>", "attribution": "<attribution string or 'via Wikimedia Commons'>", "format": "data" }`.

`imageUrl` SHALL always be the `thumbnail.source` URL (not `originalimage.source`), so the downloaded bytes — and any downstream re-fetch for the Slack file-upload hop — are the rasterized render rather than an SVG master.

#### Scenario: Successful subject lookup with Wikidata QID

- **GIVEN** the query `"Eiffel Tower"` resolves to a Wikipedia page with `wikibase_item: "Q243"` and a populated `thumbnail.source`
- **WHEN** the tool is called with `query: "Eiffel Tower"`
- **THEN** the result is multimodal: a data-mode image content block (`type: "image"` with base64 `data` and a `mimeType`); a text content block with `subjectId: "wikidata:Q243"`, `title: "Eiffel Tower"`, `imageUrl` set to the thumbnail URL, `format: "data"`, and license/attribution from Commons extmetadata

#### Scenario: Wikidata QID missing — slug fallback

- **GIVEN** the query resolves to a Wikipedia page where `wikibase_item` is absent (stub article, recently created, etc.)
- **WHEN** the tool processes the response
- **THEN** the response carries `subjectId: "wikipedia:<page-slug>"` (the page slug, URL-encoded the same way Wikipedia URLs encode it); all other fields are populated as in the QID case

#### Scenario: Empty query is rejected

- **WHEN** the tool is called with `query: ""`
- **THEN** the tool returns a structured error `{ kind: "notFound" }` (or `{ kind: "unknown" }` with a descriptive message — either is acceptable; an empty query cannot match anything)

#### Scenario: Oversized query is rejected

- **WHEN** the tool is called with `query` longer than 200 characters
- **THEN** the tool returns a structured error indicating the query bound was exceeded

### Requirement: Thumbnail preference over originalimage

The plugin SHALL always use `thumbnail.source` from the Wikipedia REST page-summary response as the value of both the image content block's `source.url` and the text metadata's `imageUrl`. The plugin SHALL NOT use `originalimage.source` even when it is present and points to a non-SVG asset.

#### Scenario: Flag query returns thumbnail PNG, not SVG master

- **GIVEN** the query `"Flag of Ecuador"` resolves to a Wikipedia page where `originalimage.source` ends in `.svg` and `thumbnail.source` ends in `.png` (a rasterized render)
- **WHEN** the tool processes the response
- **THEN** the returned `imageUrl` is the PNG thumbnail and the downloaded image bytes are that PNG render; the SVG master URL never appears in the tool result

#### Scenario: Subject with only an originalimage that is PNG still uses thumbnail

- **GIVEN** the query resolves to a page where `originalimage.source` is already PNG
- **WHEN** the tool processes the response
- **THEN** the result still uses `thumbnail.source` (smaller, faster, Slack-friendly), not the original

### Requirement: License and attribution from Commons extmetadata with graceful degradation

The plugin SHALL fetch the chosen thumbnail's Commons `imageinfo` (with `iiprop=url|extmetadata`) to populate the metadata text block's `license` and `attribution` fields:

- `license`: extracted from `extmetadata.LicenseShortName` (preferred) or `extmetadata.UsageTerms` (fallback). When neither is present, default to the literal string `"unknown"`.
- `attribution`: extracted from `extmetadata.Artist` (preferred) or `extmetadata.Credit` (fallback). HTML tags in the extracted value SHALL be stripped before storage. When neither is present, default to the literal string `"via Wikimedia Commons"`.

The plugin SHALL NOT fail the tool call when license or attribution metadata is missing — these fields degrade gracefully.

#### Scenario: License populated from extmetadata

- **GIVEN** the chosen thumbnail's Commons file has `LicenseShortName: "CC BY-SA 4.0"` and `Artist: "<a href=\"...\">Alice Photographer</a>"`
- **WHEN** the tool returns
- **THEN** the metadata block contains `license: "CC BY-SA 4.0"` and `attribution: "Alice Photographer"` (HTML stripped)

#### Scenario: License missing — defaults applied

- **GIVEN** the chosen thumbnail's Commons file has no `LicenseShortName`, `UsageTerms`, `Artist`, or `Credit` in `extmetadata`
- **WHEN** the tool returns
- **THEN** the metadata block contains `license: "unknown"` and `attribution: "via Wikimedia Commons"` (the tool succeeds; the visual-questions reveal renders `📷 Image via Wikimedia Commons`)

### Requirement: Structured error returns on failure

The plugin SHALL return a structured error result (matching the visual-questions contract's `SourceError` shape) on every failure mode:

- `kind: "notFound"` — Wikipedia REST returns 404, the page exists but has no `thumbnail.source`, or the query is empty/unmatched.
- `kind: "rateLimit"` — Wikipedia or Commons returns 429 or 503, and the plugin's bounded retry budget is exhausted.
- `kind: "network"` — Other 5xx responses after one retry, request timeout, or DNS/connection failure.
- `kind: "unknown"` — Response is HTTP 200 with valid JSON but lacks expected fields (no `thumbnail.source`, no expected page structure).
- `kind: "unsupportedFormat"` — `thumbnail.source` is an SVG (detected by `.svg` URL extension before download, or by an `image/svg+xml` Content-Type on download), or the downloaded thumbnail exceeds the size cap (5 MB). Wikipedia normally renders PNG thumbnails even for SVG masters, but degenerate cases exist.

The plugin SHALL NOT throw exceptions out of the tool call. Every error path SHALL return a structured result.

#### Scenario: Wikipedia returns 404

- **GIVEN** the query does not match any Wikipedia article
- **WHEN** Wikipedia REST returns 404
- **THEN** the tool returns `{ kind: "notFound", message: "<descriptive>" }`

#### Scenario: Rate-limit retry then surface

- **GIVEN** Wikipedia REST returns 429 twice in a row (the plugin's bounded retry budget)
- **WHEN** the tool exhausts retries
- **THEN** the tool returns `{ kind: "rateLimit", message: "<descriptive, including upstream status>" }`

#### Scenario: Rate-limit retry then success

- **GIVEN** Wikipedia REST returns 429 once, then 200 on retry
- **WHEN** the tool processes the second response
- **THEN** the tool returns the successful multimodal result (the retry is transparent to Claude)

#### Scenario: Malformed response — unknown error

- **GIVEN** Wikipedia REST returns 200 with valid JSON but the response lacks `thumbnail.source` AND lacks `originalimage.source`
- **WHEN** the tool processes the response
- **THEN** the tool returns `{ kind: "unknown", message: "<descriptive>" }`

#### Scenario: Network timeout

- **GIVEN** the Wikipedia REST request does not complete within 5 seconds
- **WHEN** the timeout fires
- **THEN** the tool returns `{ kind: "network", message: "<timeout message>" }`

### Requirement: Wikimedia API etiquette

The plugin SHALL set a descriptive `User-Agent` header on every Wikipedia REST and Commons API request, following Wikimedia's User-Agent policy. The header value SHALL include the bot/project name (e.g., `Clack-Trivia-Image-Search/1.0`).

The plugin SHALL implement bounded retry-with-backoff for `429` and `503` responses: a maximum of 2 retries with jittered exponential backoff starting at 500ms. Each HTTP call SHALL time out after 5 seconds.

#### Scenario: User-Agent set on outbound requests

- **WHEN** the plugin issues a Wikipedia REST or Commons API request
- **THEN** the request includes a `User-Agent` header identifying the bot/project (not an empty or default User-Agent)

#### Scenario: Bounded retries on rate-limit

- **GIVEN** the upstream returns 429 (or 503) on the initial request
- **WHEN** the plugin retries
- **THEN** the retry uses exponential backoff with jitter; after at most 2 retries the plugin gives up and returns `{ kind: "rateLimit" }`

### Requirement: Stateless plugin — no caching, no API key

The plugin SHALL NOT cache responses, in memory or on disk. Each `find_subject` call SHALL perform fresh HTTP requests to Wikipedia REST and Commons API.

The plugin SHALL NOT require any API key or admin credential to operate. The Wikipedia REST and Commons APIs are keyless.

#### Scenario: Repeated calls hit upstream fresh

- **GIVEN** the same query is sent twice within a single trivia run
- **WHEN** the plugin processes each call
- **THEN** both calls perform full HTTP round-trips to Wikipedia/Commons (no plugin-side cache); identical responses on both calls are coincidental, not cached

#### Scenario: Plugin loads without configuration

- **GIVEN** no `commons-image-search` configuration is present in `config.json` or `data/auth/`
- **WHEN** the plugin loads
- **THEN** the plugin loads successfully and registers its tool (no `keyMissing` error, no config-required gate)
