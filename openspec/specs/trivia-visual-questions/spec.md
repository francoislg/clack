# Trivia Visual Questions

## Purpose

Image-medium questions for the Trivia plugin, enabling identification, claim, and freeform-answer templates with visual prompts alongside the existing text-medium modalities. Combines image-search MCP plugins with Claude's image inspection, subject-level dedup, and direct public-URL rendering (the prompt builds the Block Kit `image` block from `media.url`) for seamless visual question delivery.

## Requirements

### Requirement: promptMedium axis on question records and configuration

The system SHALL persist `promptMedium: "text" | "image"` on every newly-written `TriviaQuestion` record. When a stored record carries no `promptMedium` field, the system SHALL read it as `"text"`. The system SHALL accept a `promptMedium` weight map of the shape `Record<"text" | "image", number>` (non-negative integer weights) at three cascade tiers: `config.trivia.promptMedium`, `SeasonEntry.promptMedium`, and `SeasonFormatSlot.promptMedium`. Resolution priority on each `get_ideas` call SHALL be:

1. Slot's `promptMedium` (when the active season has a `format` and the resolved slot has the field).
2. Season's `promptMedium` (when set on the current `SeasonEntry`).
3. `config.trivia.promptMedium`.
4. Default `{ text: 1, image: 0 }` — equivalent to pre-change behavior.

The system SHALL re-read these sources on every `get_ideas` call (no caching). The system SHALL reject configurations whose `promptMedium` maps have all-zero weights or contain keys other than `"text"` and `"image"`.

#### Scenario: Legacy record without promptMedium reads as text

- **GIVEN** a stored `TriviaQuestion` record with no `promptMedium` field
- **WHEN** any code path reads the record
- **THEN** the system treats it as `promptMedium: "text"`

#### Scenario: Default configuration generates text-only questions

- **GIVEN** no `promptMedium` weights are set at any cascade tier
- **WHEN** `get_ideas` is called repeatedly
- **THEN** `suggestedPromptMedium` is always `"text"`

#### Scenario: Slot weights override season weights

- **GIVEN** `config.trivia.promptMedium: { text: 1, image: 0 }`
- **AND** the active season's `promptMedium: { text: 1, image: 1 }`
- **AND** the active slot's `promptMedium: { text: 0, image: 1 }`
- **WHEN** `get_ideas` rolls for that slot
- **THEN** `suggestedPromptMedium` is always `"image"` (slot's all-image weights win)

### Requirement: media field on image-medium questions

When `TriviaQuestion.promptMedium === "image"`, the record SHALL carry a `media: { kind: "image", url: string, altText: string, subjectId: string, title: string, license?: string, attribution?: string }` field. When `promptMedium` is `"text"` (or absent), the record SHALL NOT carry a `media` field.

The `slackFileId` / `slackFileUrl` fields are REMOVED — there is no Slack re-hosting, so nothing stamps them. The question-generation prompt builds a Block Kit `image` block from `media.url` (the upstream public URL the image-search tool returned in its metadata block) directly into the blocks it hands to `post_questions`; `post_questions` posts it as-is. Records persisted before this change that still carry those keys deserialize harmlessly (the extra keys are ignored).

`media.subjectId` SHALL be a source-namespaced identifier of the form `"<source>:<id>"` (e.g., `"wikidata:Q243"`, `"commons:File:Eiffel_Tower.jpg"`, `"tmdb:m-550"`, `"brave:<hash>"`) — whatever the originating image-search plugin returned. Trivia does NOT constrain the namespace or the id format; `find_previous_subjects` matches the exact stored string. `media.url` SHALL be an HTTPS URL. `media.altText` SHALL be non-empty (used for accessibility and as the rendered Slack `alt_text`).

#### Scenario: Image-medium question carries media

- **WHEN** `save_question` writes a question with `promptMedium: "image"`
- **THEN** the stored record has a `media` object with `kind`, `url`, `altText`, `subjectId`, and `title` populated, and no `slackFileId` / `slackFileUrl`

#### Scenario: Text-medium question rejects media

- **WHEN** `save_question` is called with `promptMedium: "text"` (or absent) and a `media` argument
- **THEN** the tool returns an error explaining that media is only allowed on image-medium questions

### Requirement: image medium combines freely with all three answer formats

The `promptMedium` and `answersFormat` axes SHALL roll independently in `get_ideas`. All six combinations of `promptMedium × answersFormat` SHALL be permitted: `image + choice` (identification template + N options), `image + boolean` (claim template), and `image + freeform` (typed-identification template) are all first-class shapes. The system SHALL NOT impose a cross-axis constraint at `get_ideas`, at `save_question`, or anywhere else.

The image+boolean shape uses a *claim-based* template: the image is evidence, and the statement asserts an identity or property about it ("This is the flag of Ecuador. T/F"). The distractor lives in the claim — typically a swap to a confusable subject when the rolled polarity is FALSE.

The image+freeform shape uses a *typed-identification* template: a templated prompt ("Who is this?", "What animal is this?", "Which landmark is shown?") + text input. `expectedAnswer` is the subject's canonical title from the image-search tool's metadata block (`title` field). `acceptableAnswers` MAY enumerate observed variants (e.g., "Eiffel Tower" / "La Tour Eiffel"). The reveal-time Haiku judge (from the freeform proposal) handles spelling forgiveness and multi-guess rejection.

#### Scenario: All three image-medium combinations roll naturally

- **GIVEN** `promptMedium: { text: 0, image: 1 }` and `answersFormat: { boolean: 1, choice: 1, freeform: 1 }`
- **WHEN** `get_ideas` is called many times
- **THEN** the three answer-formats appear in roughly equal proportions, all with `suggestedPromptMedium: "image"`

#### Scenario: Image + boolean saves successfully

- **WHEN** `save_question` is called with `promptMedium: "image"`, `answersFormat: "boolean"`, `isTrue: true`, and a valid `media` object
- **THEN** the question is persisted with all three fields and no validation error

#### Scenario: Image + choice saves successfully

- **WHEN** `save_question` is called with `promptMedium: "image"`, `answersFormat: "choice"`, valid `choices` + `correctIndex`, and a valid `media` object
- **THEN** the question is persisted with all fields and no validation error

#### Scenario: Image + freeform saves successfully

- **WHEN** `save_question` is called with `promptMedium: "image"`, `answersFormat: "freeform"`, `expectedAnswer: "Capybara"`, optional `acceptableAnswers: ["Hydrochoerus hydrochaeris"]`, and a valid `media` object
- **THEN** the question is persisted with `media`, `expectedAnswer`, and `acceptableAnswers`; the reveal flow will use the existing freeform Haiku judge for answer validation

### Requirement: image medium reuses the standard category pool

Image-medium questions SHALL draw `categories.ideas` from the existing `data/plugins/trivia/categories.json` pool, using the same season/slot category cascade and recent-exclusion window as text-medium questions. The system SHALL NOT maintain a separate visual category pool, SHALL NOT add a `pool` argument to `add_categories`/`remove_categories`, and SHALL NOT perform any `get_ideas`-side empty-pool fallback for image rolls. `get_ideas` SHALL roll `suggestedPromptMedium` independently of category selection and return category ideas from the same pool regardless of the rolled medium.

When an image roll lands on a category for which no usable visual subject can be found, the prompt's visual research subflow SHALL handle it via its re-roll budget (re-roll candidates, then re-roll to a different category in `categories.ideas`, then fall back to text-medium) — see the image-inspection and retry-budget requirements below.

#### Scenario: Image roll draws from the standard pool

- **GIVEN** `categories.json` contains the standard seeded list
- **AND** `get_ideas` rolls `suggestedPromptMedium: "image"`
- **WHEN** the response is returned
- **THEN** `categories.ideas` is drawn from `categories.json` (the same pool used for text rolls), filtered by the active season/slot categories and the recent-exclusion window

#### Scenario: Image roll on a non-visual category degrades to text

- **GIVEN** `promptMedium: { text: 0, image: 1 }` and the rolled category has no usable visual subject
- **WHEN** the visual research subflow exhausts its candidate and category re-rolls
- **THEN** the visual path aborts and falls back to the text-medium path for the same `answersFormat × questionType`; no error surfaces

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
- **AND** the returned image is a 19th-century engineering diagram, not a photograph of the tower
- **WHEN** Claude inspects the inline image
- **THEN** Claude judges subject-match failed (the engineering diagram is not what players will recognize as the Eiffel Tower) and re-rolls — either by calling the same tool with a refined query, switching to a different image-search tool, or moving to a different category

#### Scenario: Image with text overlay triggers re-roll

- **GIVEN** Claude called an image-search tool with `query: "Cardinal"` and the returned image has the caption "Northern Cardinal" baked into the lower-right corner
- **WHEN** Claude inspects the image
- **THEN** Claude judges answer-leakage failed and re-rolls

#### Scenario: Clean image passes inspection and informs statement

- **GIVEN** Claude called an image-search tool with `query: "Capybara"` and the returned image is a clear photo of a single capybara on a grassy bank
- **WHEN** Claude inspects the image
- **THEN** all four checks pass, Claude proceeds to the statement-writing step, and the observed distinguishing features (size, body shape, semi-aquatic setting) inform distractor selection for choice or claim selection for boolean

#### Scenario: Retry budget exhaustion falls back to text

- **GIVEN** Claude has attempted 3 candidates in a category, all failing inspection (subject-mismatch or text-overlay), then attempted 2 alternate categories, also failing
- **WHEN** the retry budget is exhausted
- **THEN** Claude aborts the visual path and re-rolls `get_ideas` once, allowing the next roll to produce a text-medium question if the visual roll fails again

### Requirement: find_previous_subjects MCP tool for subject-level dedup

The system SHALL expose a `find_previous_subjects({ game, subjectId, season? })` MCP tool that returns saved questions whose `media.subjectId` matches the argument. Statement-text dedup via `find_previous_questions` is insufficient for visual questions (their statements are templated: "Who is this?", "What animal?"); subject-level dedup is the correct key. The `season` argument SHALL accept `"all"` (default), `"current"`, or an explicit slug, with the same semantics as `find_previous_questions`.

The response SHALL be `{ matches: Array<{ id, statement, createdAt, postedAt?, processedAt?, media: { title, subjectId } }>, count }`. The response SHALL NOT include the answer key (`correctIndex`) for matching questions — same convention as `find_previous_questions`.

#### Scenario: Subject hit returns the prior question

- **GIVEN** a question saved with `media.subjectId: "wikidata:Q243"`
- **WHEN** `find_previous_subjects({ game, subjectId: "wikidata:Q243" })` is called
- **THEN** the response includes that question in `matches`

#### Scenario: Subject miss returns empty

- **WHEN** `find_previous_subjects` is called with a subjectId not present in any saved question
- **THEN** the response is `{ matches: [], count: 0 }`

#### Scenario: Legacy records without media are filtered

- **GIVEN** a game's saved questions include records from before this change (no `media` field)
- **WHEN** `find_previous_subjects` is called
- **THEN** legacy records are not included in `matches` (they have no subjectId to match)

### Requirement: reveal flow surfaces image attribution

When `process_reveal_answers` returns a reveal entry whose question has `media`, the payload SHALL include `media: { title, attribution?, license? }` on that entry (excluding `url` and `subjectId` — not needed for rendering and unnecessary leak surface). When rendering the reveal, the prompt SHALL include exactly one additional `context` block above the closer with the text:

- `"📷 Image: <attribution> · <license>"` when both attribution and license are present, OR
- `"📷 Image: <attribution>"` when license is absent, OR
- omit the block entirely when both are absent.

The question card itself SHALL NOT include attribution at posting time (avoids leaking subject hints via the attribution string).

#### Scenario: Reveal payload includes media metadata

- **GIVEN** a pending reveal for a question with `media.attribution: "Photo by X"` and `media.license: "CC-BY-SA-4.0"`
- **WHEN** `process_reveal_answers` returns its payload
- **THEN** `reveals[0].media` is `{ title, attribution: "Photo by X", license: "CC-BY-SA-4.0" }`

#### Scenario: Reveal payload excludes raw URL and subjectId

- **WHEN** `process_reveal_answers` returns a reveal entry for an image-medium question
- **THEN** the payload's `reveals[i].media` does NOT include `url` or `subjectId`
