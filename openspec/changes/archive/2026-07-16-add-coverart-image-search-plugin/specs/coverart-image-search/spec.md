## ADDED Requirements

### Requirement: Single keyless album-cover MCP tool

The plugin SHALL expose one MCP tool, `find_album`, on its always-on default server. It SHALL accept one required argument `query: string` (non-empty, ≤ 200 characters; longer queries SHALL be rejected with a structured error). The tool's DESCRIPTION SHALL identify it as a keyless album-cover source backed by MusicBrainz + the Cover Art Archive, good for "what album is this cover?" with an `artist album` or album-title query, so trivia — which discovers image sources by description, not by tool name — selects it for music-cover categories. The plugin SHALL be keyless: it loads and operates with no API key and no configuration.

#### Scenario: Album-cover category routes to find_album

- **GIVEN** trivia's visual research subflow has a rolled music-cover category
- **AND** `find_album`'s description is present in Claude's tool list
- **WHEN** Claude reads the descriptions to pick a tool
- **THEN** Claude calls `find_album` with a query naming the album (e.g. `"Pink Floyd Dark Side of the Moon"`)

#### Scenario: Empty query is rejected

- **WHEN** `find_album` is called with `query: ""`
- **THEN** the tool returns a structured error indicating the query was empty

#### Scenario: Oversized query is rejected

- **WHEN** `find_album` is called with `query` longer than 200 characters
- **THEN** the tool returns a structured error indicating the query bound was exceeded

### Requirement: Two-hop resolution — MusicBrainz release-group then Cover Art Archive

`find_album` SHALL resolve a cover as follows:

1. Search MusicBrainz `release-group` for the query (`https://musicbrainz.org/ws/2/release-group/?query=<enc>&fmt=json&limit=10`).
2. Iterate the returned release-groups in rank order; for each, fetch `https://coverartarchive.org/release-group/<mbid>/front-500`.
3. The first release-group whose CAA fetch returns an image is selected. A release-group with no cover art (CAA 404) SHALL cause the plugin to advance to the next candidate.
4. The plugin SHALL attempt the CAA fetch on at most the first 3 candidate release-groups; when none in that budget yields a cover, it SHALL return `{ kind: "notFound" }`.
5. When MusicBrainz returns zero release-groups, the tool SHALL return `{ kind: "notFound" }`.

#### Scenario: Top release-group has a cover

- **GIVEN** `find_album("Dark Side of the Moon")` and MusicBrainz's top release-group is MBID `abc` with a CAA front cover
- **WHEN** the tool resolves
- **THEN** it downloads `https://coverartarchive.org/release-group/abc/front-500` and `subjectId` is `coverart:rg-abc`

#### Scenario: Top release-group lacks a cover — next candidate used

- **GIVEN** MusicBrainz's top release-group (MBID `a`) returns CAA 404 and the 2nd (MBID `b`) has a cover
- **WHEN** `find_album` iterates
- **THEN** the 2nd is selected; `subjectId` is `coverart:rg-b`

#### Scenario: No cover within the budget — notFound

- **GIVEN** the first 3 release-groups all return CAA 404
- **THEN** the tool returns `{ kind: "notFound", message: "<descriptive>" }`

#### Scenario: Zero MusicBrainz results — notFound

- **GIVEN** MusicBrainz returns `{ "release-groups": [] }`
- **THEN** the tool returns `{ kind: "notFound", message: "<descriptive>" }`

### Requirement: Multimodal data-mode return per the visual-questions contract

On success, `find_album` SHALL return a multimodal MCP tool result containing:

1. An **image content block** in data mode: `{ "type": "image", "data": "<base64 of the downloaded CAA cover>", "mimeType": "image/<jpeg|png|webp>" }` (MIME from `Content-Type`, fallback to the URL extension).
2. A **text content block** with JSON metadata: `{ "source": "coverart", "subjectId": "coverart:rg-<mbid>", "title": "<artist> – <album>", "imageUrl": "<CAA cover URL>", "license": "unknown", "attribution": "via Cover Art Archive", "format": "data" }`.

`imageUrl` SHALL be the canonical CAA cover URL (`https://coverartarchive.org/release-group/<mbid>/front-500` — NOT the post-redirect target, so the same album always yields the same `imageUrl`) whose bytes are in the data block. The plugin SHALL NOT use URL-mode image content blocks.

#### Scenario: Successful album lookup is multimodal

- **GIVEN** `find_album("Pink Floyd Dark Side of the Moon")` resolves release-group MBID `abc`, artist credit "Pink Floyd", title "The Dark Side of the Moon", with a CAA cover
- **WHEN** the tool returns
- **THEN** the result has a data-mode image block (base64 of the `front-500` cover) and a text block with `source: "coverart"`, `subjectId: "coverart:rg-abc"`, `title: "Pink Floyd – The Dark Side of the Moon"`, `imageUrl` the CAA cover URL, `license: "unknown"`, `attribution: "via Cover Art Archive"`, `format: "data"`

### Requirement: subjectId is the namespaced release-group MBID

`subjectId` SHALL be `"coverart:rg-" + <release-group MBID>`. The same release-group SHALL always produce the same `subjectId`, so trivia's `find_previous_subjects` dedups re-encounters of the same album.

#### Scenario: Same release-group → same subjectId

- **GIVEN** two `find_album` calls that both resolve release-group MBID `abc`
- **THEN** both results have `subjectId: "coverart:rg-abc"`

### Requirement: title composed from artist credit and album title

`title` SHALL be `"<first artist-credit name> – <release-group title>"` (multi-artist credits use the first name only). When the artist credit is absent, `title` SHALL be the release-group title alone.

#### Scenario: Title includes artist and album

- **GIVEN** the selected release-group has artist credit "Nirvana" and title "Nevermind"
- **THEN** `title` is `"Nirvana – Nevermind"`

#### Scenario: Title falls back to album when no artist credit

- **GIVEN** the selected release-group has title "Untitled" and no artist credit
- **THEN** `title` is `"Untitled"`

### Requirement: license unknown, attribution constant

The plugin SHALL set `license` to the literal `"unknown"` and `attribution` to the literal `"via Cover Art Archive"` on every successful result.

#### Scenario: Constants on every success

- **WHEN** `find_album` returns successfully
- **THEN** `license` is exactly `"unknown"` AND `attribution` is exactly `"via Cover Art Archive"`

### Requirement: Keyless operation with MusicBrainz/CAA etiquette

The plugin SHALL operate with no API key and no configuration, and SHALL NOT import core config. It SHALL set a descriptive `User-Agent` header on every MusicBrainz and CAA request (per MusicBrainz's User-Agent policy). It SHALL apply bounded retry-with-backoff on 429/503 responses (at most 2 jittered exponential-backoff retries, then `rateLimit`; other 5xx get one retry, then `network` — the Commons `requestRaw` policy). There SHALL be no `keyMissing` error path.

#### Scenario: Plugin loads and works with no configuration

- **GIVEN** no configuration for the plugin
- **WHEN** the plugin loads and `find_album` is called
- **THEN** the plugin loads successfully and performs the MusicBrainz + CAA requests with a descriptive `User-Agent`, returning a result or a structured error (never `keyMissing`)

#### Scenario: Rate-limit backoff then success

- **GIVEN** MusicBrainz returns 503 once, then 200 on retry
- **WHEN** the plugin issues the search
- **THEN** it backs off, retries, and proceeds with the 200 response

### Requirement: Image download with size cap and format guard

On selecting a cover, the plugin SHALL download the CAA image bytes, detecting MIME from `Content-Type` (falling back to the URL extension). SVG is detected via that resolved MIME (`image/svg+xml`) and SHALL be rejected with a structured error, as SHALL a non-image resolved MIME; the plugin SHALL enforce a 5 MB raw-byte cap (rejecting larger payloads).

#### Scenario: Oversized cover rejected

- **GIVEN** the selected cover exceeds 5 MB
- **THEN** the tool returns `{ kind: "unsupportedFormat", message: "<descriptive size>" }`

#### Scenario: Non-image content-type rejected

- **GIVEN** the cover download returns `Content-Type: text/html`
- **THEN** the tool returns `{ kind: "unknown", message: "<descriptive>" }`

### Requirement: Structured error returns on failure

The plugin SHALL return a structured error (matching the visual-questions `SourceError` shape) on every failure mode and SHALL NOT throw out of the tool call:

- `notFound` — zero MusicBrainz results, or no cover within the candidate budget.
- `rateLimit` — 429/503 persists after bounded retries (MusicBrainz or CAA).
- `network` — 5xx (after retry), timeout, connection failure, or an image-download transport failure.
- `unsupportedFormat` — selected cover is SVG or exceeds the 5 MB cap.
- `unknown` — 200 with valid JSON but a missing/malformed `release-groups` array, or a non-image download `Content-Type`.

The plugin SHALL NOT return `keyMissing` (it is keyless).

#### Scenario: MusicBrainz 5xx — network

- **GIVEN** MusicBrainz returns 500 on initial and on retry
- **THEN** the tool returns `{ kind: "network", message: "<descriptive>" }`

#### Scenario: Malformed search response — unknown

- **GIVEN** MusicBrainz returns 200 with valid JSON but missing the `release-groups` array
- **THEN** the tool returns `{ kind: "unknown", message: "<descriptive>" }`

#### Scenario: CAA cover download transport failure — network

- **GIVEN** MusicBrainz resolves a release-group but the CAA cover download times out
- **THEN** the tool returns `{ kind: "network", message: "<descriptive>" }`

### Requirement: Stateless plugin — no caching

The plugin SHALL NOT cache responses, in memory or on disk. Each `find_album` call SHALL perform a fresh MusicBrainz search, fresh CAA cover fetch(es), and a fresh image download.

#### Scenario: Repeated calls hit upstream fresh

- **GIVEN** the same query is sent to `find_album` twice within one trivia run
- **WHEN** the plugin processes each call
- **THEN** both perform full HTTP round-trips; no plugin-side cache
