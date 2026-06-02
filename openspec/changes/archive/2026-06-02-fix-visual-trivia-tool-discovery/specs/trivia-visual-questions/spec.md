## MODIFIED Requirements

### Requirement: external image-search MCP tool contract

Image sources are external Clack plugins that expose MCP tools. The trivia plugin does NOT contain any image-source code, registry, or router. Each image-search plugin is delivered as its own OpenSpec change (`add-commons-image-search-plugin`, `add-brave-image-search-plugin`, etc.). This requirement documents the contract those plugins MUST follow so the trivia prompt can use them uniformly.

**Tool discovery — by description, not by name.** The trivia visual-research subflow SHALL discover image sources by reading each available tool's **description**, NOT by matching a substring in the tool's name. A tool is an image source when its description identifies it as one for trivia: it accepts a subject `query` and returns an image inline plus the metadata block defined below. Tool names are NOT load-bearing for discovery. Plugin authors SHOULD give image tools a recognizable name (e.g. ending in `-image-search`) as a human-readability aid, but the binding signals are the description and the return/error contract. (Built-in plugins register under hyphenated server names, so their tools resolve to e.g. `mcp__commons-image-search__find_subject` and `mcp__brave-image-search__find_image` — the Agent SDK uses the MCP server name verbatim, with no hyphen→underscore conversion.)

**Argument contract.** Each image-search tool SHALL accept at minimum:

- `query: string` (required, non-empty, ≤ 200 characters) — the subject hint. Tools SHALL reject empty or oversized queries with a structured error.

Tools MAY accept additional optional arguments (e.g., `category: string`, `imageKind: "poster" | "still"`) — the trivia prompt is agnostic to these; it reads the tool's description to determine how to invoke it.

**Return contract — multimodal data-mode result.** On success, an image-search tool SHALL return a multimodal MCP tool result containing both:

1. **An image content block** carrying the downloaded bytes, in the MCP `CallToolResult` image shape:

   ```
   { type: "image", data: "<base64>", mimeType: "image/<jpeg|png|webp|gif>" }
   ```

   The plugin downloads the upstream image, base64-encodes it (≤ 5 MB, raster formats only — SVG rejected), and returns it inline so Claude can inspect the pixels. **There is no URL-source mode.** The MCP tool-result content union expresses an image only as `{ type: "image", data, mimeType }`; `source: { type: "url", url }` is the Anthropic Messages-API shape, not an MCP tool-result shape, so plugins cannot return a URL-source image block (see design.md Decision 5).

2. **A text content block** carrying metadata JSON:

   ```
   { "source": "<plugin-name>",
     "subjectId": "<source-namespaced-id>",
     "title": "<canonical title>",
     "imageUrl": "<upstream HTTPS URL — always populated>",
     "license": "<license string, optional, may be 'unknown'>",
     "attribution": "<attribution string, optional>",
     "format": "data" }
   ```

`imageUrl` SHALL always be populated (`post_questions` uses it later to re-fetch and upload to Slack with a neutral filename — the plugin downloaded the bytes for Claude's inspection; `post_questions` re-fetches them for the upload). The `format` field is always `"data"` today; it is retained as a forward-compat discriminator in case a future transport adds a URL-source variant.

**Source-namespaced `subjectId`.** Each plugin SHALL prefix its `subjectId` with a stable identifier for the source. Examples plugins SHOULD follow:

- `commons:File:Eiffel_Tower.jpg` or `wikidata:Q243`
- `tmdb:m-550` (movie), `tmdb:tv-1399` (series), `tmdb:p-287` (person)
- `inaturalist:46327`
- `mbid:550e8400-...` (Cover Art Archive / MusicBrainz UUIDs)
- `jikan:1`, `jikan:c-1`
- `openlibrary:OL27448M`
- `nasa:PIA12345`
- `met:436532`
- `brave:<sha256-of-imageUrl, first 12 chars>` (generic search, URL hash since no native ID)

**Cross-namespace matching is NOT performed.** `tmdb:m-550` and `wikidata:Q172241` are distinct keys even if they refer to the same subject. Trivia's `find_previous_subjects` matches exact strings.

**Error contract.** On failure, the tool SHALL return a structured error result with `kind` in the discriminated union:

```
{ kind: "notFound" | "rateLimit" | "network" | "tooLarge" | "unsupportedFormat" | "unknown" | "keyMissing", message: string }
```

An oversized image (over the plugin's byte cap) MAY be reported as either `tooLarge` or `unsupportedFormat` — the shipped Commons and Brave plugins fold the >5 MB case into `unsupportedFormat`. Trivia treats every error kind identically (re-roll), so the distinction is informational. `keyMissing` is returned when the plugin's required API key is unset — the trivia prompt treats this as "tool unavailable for this run" and tries the next available image-search tool.

**No trivia-internal registry / router / priority table.** Each plugin is responsible for its own:
- HTTP fetching and byte download (every plugin is data-mode — see the return contract).
- Rate limit / retry / backoff handling.
- License + attribution metadata extraction.
- Key configuration and key-missing handling.

The trivia plugin neither knows the list of available image-search plugins nor routes between them. Claude inspects its tool list at runtime and picks the appropriate tool for the rolled category based on tool descriptions.

#### Scenario: Image-search plugin returns a data-mode multimodal result

- **GIVEN** a Commons image-search plugin is installed and exposes a `find_subject(query)` tool described as a trivia image source (resolved name `mcp__commons-image-search__find_subject`)
- **WHEN** Claude calls the tool with `query: "Eiffel Tower"`
- **THEN** the tool downloads the upstream thumbnail and returns a multimodal result with an image content block `{ type: "image", data: "<base64>", mimeType: "image/jpeg" }` (bytes ≤ 5 MB) AND a text content block `{ source: "commons", subjectId: "wikidata:Q243", title: "Eiffel Tower", imageUrl: "https://upload.wikimedia.org/.../thumbnail.jpg", license: "CC-BY-SA 4.0", attribution: "...", format: "data" }`

#### Scenario: imageUrl is preserved for the post-time re-fetch

- **GIVEN** an image-search tool returned a data-mode result whose metadata carries `imageUrl`
- **WHEN** the resulting question is later processed by `post_questions`
- **THEN** `post_questions` re-fetches `imageUrl` and uploads it to Slack (the inline bytes were for Claude's inspection only; they are not reused at post time)

#### Scenario: keyMissing skips the tool silently

- **GIVEN** an opt-in image-search plugin (e.g., TMDB) is installed but its API key is unset
- **WHEN** Claude calls one of its tools
- **THEN** the tool returns `{ kind: "keyMissing", message: "TMDB_API_KEY not configured" }`; the trivia prompt treats this as "tool unavailable" and either tries another image-search tool or falls back per the no-tool short-circuit

#### Scenario: No image-search tool available — visual path short-circuits to text

- **GIVEN** trivia rolls `suggestedPromptMedium: "image"`
- **AND** Claude surveys its available tools and none is described as a trivia image source (no image-search plugin installed)
- **WHEN** the visual research subflow reaches its tool-selection step
- **THEN** the subflow aborts the visual path without consuming the retry budget and falls back to the text-medium prompt path for the same `answersFormat × questionType`; no errors surface to end users

### Requirement: Claude inspects the image before writing the question

The visual research subflow in the question-posting prompt SHALL include an **image inspection gate** that runs after an image-search tool returns and before any statement is written. The gate evaluates the inline image returned by the tool on four checks:

1. **Subject match.** Does the image depict the subject named in the metadata? (Wikipedia main images are occasionally diagrams, coats of arms, maps, or tangentially-related photos rather than canonical subject depictions.)
2. **Subject clarity.** Is the subject clearly visible without heavy obstruction or competing subjects? Is the angle, scale, and quality sufficient for a player to recognize or evaluate it?
3. **Answer leakage.** Does the image contain text, captions, watermarks, labels, or any other in-image content that reveals the answer?
4. **Distinguishing features.** What is visually evident in the image that can inform distractor choice (for choice template) or identity-swap selection (for boolean claim template)?

If checks (1), (2), or (3) fail, Claude SHALL re-roll the research subflow — either by calling the same image-search tool with a different `query`, by switching to a different available image-search tool, or by moving to a different category from `categories.ideas`. The failure is silent (no tool error) — same pattern as the duplicate-detection step.

**Retry budget**: up to 3 candidate re-rolls within the same category, then up to 2 category re-rolls (moving to a different entry in `categories.ideas`). When all attempts are exhausted, the visual path SHALL abort and re-roll the entire `get_ideas` call once. The re-roll MAY yield `suggestedPromptMedium: "text"`, which is the expected graceful-degradation outcome (a text question instead of failing the cron fire entirely).

The observations from check (4) SHALL be carried forward into the statement-writing step (the choice path uses them for distractor selection; the boolean claim path uses them for identity-swap selection or image-grounded property selection).

#### Scenario: Subject-mismatch image triggers re-roll

- **GIVEN** Claude called an image-search tool with `query: "Eiffel Tower"`
- **WHEN** the returned image is a map or diagram rather than a photo of the tower
- **THEN** the subject-match check fails and Claude re-rolls within the retry budget

#### Scenario: Image with text overlay triggers re-roll

- **GIVEN** an image-search tool returned an image that contains a caption naming the subject
- **WHEN** the answer-leakage check runs
- **THEN** the check fails and Claude re-rolls (the answer must not be readable off the image)

#### Scenario: Clean image passes inspection and informs statement

- **GIVEN** an image-search tool returned a clear, label-free image matching the subject
- **WHEN** the inspection gate passes
- **THEN** Claude proceeds to statement writing and carries the distinguishing-feature observations into distractor / identity-swap selection

#### Scenario: Retry budget exhaustion falls back to text

- **GIVEN** every candidate and category re-roll within the retry budget failed inspection or dedup
- **WHEN** the budget is exhausted
- **THEN** the visual path aborts and re-rolls `get_ideas`, which is expected to yield a text-medium question; no error surfaces
