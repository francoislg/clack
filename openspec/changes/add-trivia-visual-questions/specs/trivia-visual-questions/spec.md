## ADDED Requirements

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

When `TriviaQuestion.promptMedium === "image"`, the record SHALL carry a `media: { kind: "image", url: string, altText: string, subjectId: string, title: string, license?: string, attribution?: string, slackFileId?: string }` field. When `promptMedium` is `"text"` (or absent), the record SHALL NOT carry a `media` field.

`media.subjectId` SHALL follow the format `"wikidata:Q<n>"` when a Wikidata QID is known, or `"wikipedia:<slug>"` as a fallback. `media.url` SHALL be an HTTPS URL. `media.altText` SHALL be non-empty (used for accessibility and as the rendered Slack `alt_text`).

#### Scenario: Image-medium question carries media

- **WHEN** `save_question` writes a question with `promptMedium: "image"`
- **THEN** the stored record has a `media` object with `kind`, `url`, `altText`, `subjectId`, and `title` populated

#### Scenario: Text-medium question rejects media

- **WHEN** `save_question` is called with `promptMedium: "text"` (or absent) and a `media` argument
- **THEN** the tool returns an error explaining that media is only allowed on image-medium questions

### Requirement: image medium combines freely with all three answer formats

The `promptMedium` and `answersFormat` axes SHALL roll independently in `get_ideas`. All six combinations of `promptMedium × answersFormat` SHALL be permitted: `image + choice` (identification template + N options), `image + boolean` (claim template), and `image + freeform` (typed-identification template) are all first-class shapes. The system SHALL NOT impose a cross-axis constraint at `get_ideas`, at `save_question`, or anywhere else.

The image+boolean shape uses a *claim-based* template: the image is evidence, and the statement asserts an identity or property about it ("This is the flag of Ecuador. T/F"). The distractor lives in the claim — typically a swap to a confusable subject when the rolled polarity is FALSE.

The image+freeform shape uses a *typed-identification* template: a templated prompt ("Who is this?", "What animal is this?", "Which landmark is shown?") + text input. `expectedAnswer` is the subject's canonical title from `find_visual_subject.result.title`. `acceptableAnswers` MAY enumerate observed variants (e.g., "Eiffel Tower" / "La Tour Eiffel"). The reveal-time Haiku judge (from the freeform proposal) handles spelling forgiveness and multi-guess rejection.

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

### Requirement: visual category pool with empty-pool fallback

The system SHALL maintain a parallel `data/plugins/trivia/visualCategories.json` file holding a flat `string[]` of visual-eligible categories. When `get_ideas` rolls `suggestedPromptMedium === "image"`, it SHALL draw `categories.ideas` from this visual pool instead of the general `categories.json` pool. When the visual pool is missing or empty, `get_ideas` SHALL re-roll `suggestedPromptMedium` to `"text"` and log a debug-level message.

On first read, when the file is missing, the system SHALL seed it from a default `SEED_VISUAL_CATEGORIES` list (subset of categories well-covered by Wikipedia/Commons: people, landmarks, animals, paintings, flags, etc.) and write the seed to disk.

#### Scenario: Image roll draws from visual pool

- **GIVEN** `visualCategories.json` contains `["Famous People", "Landmarks", "Animals"]`
- **AND** `get_ideas` rolls `suggestedPromptMedium: "image"`
- **WHEN** the response is returned
- **THEN** every entry in `categories.ideas` is from the visual pool, not the general pool

#### Scenario: Empty visual pool triggers text fallback

- **GIVEN** `promptMedium: { text: 0, image: 1 }` and `visualCategories.json` is empty
- **WHEN** `get_ideas` is called
- **THEN** `suggestedPromptMedium` is `"text"` and `categories.ideas` is drawn from the general pool

### Requirement: find_visual_subject MCP tool routes over a pluggable source registry

The system SHALL expose a `find_visual_subject({ game, category, hint? })` MCP tool implemented as a router over a registry of image-source adapters. The tool SHALL NOT be locked to any single source.

**Source adapter contract:** Each registered source SHALL implement a `SourceAdapter` with:

- `name`: a stable string identifier (`commons`, `tmdb`, `inaturalist`, `jikan`, `cover_art_archive`, `nasa`, `met`, `openverse`, `open_library`, `rawg`, …).
- `categories`: either an explicit list of trivia categories this source handles, or `"*"` for a general fallback.
- `requiresKey: boolean` + optional `keyConfigPath: string` for opt-in sources.
- `isAvailable()`: returns `false` when a required key is unset.
- `find({ category, hint? })`: returns either `{ ok: true, result: SubjectResult }` or `{ ok: false, error: SourceError }`.

**`SubjectResult` shape:**

```
{ source, subjectId, title, imageUrl, imageBytes, imageMimeType, license?, attribution?, summary? }
```

- `source` echoes the adapter name.
- `subjectId` is **source-namespaced** (see below) and is the canonical dedup key.
- `imageBytes` is the downloaded image (≤ 5 MB, JPEG/PNG/WebP/GIF only).
- `imageMimeType` is the detected MIME type used to construct the multimodal tool result.

**Router behavior:**

1. Load the registry from config + defaults. Compute the active set of adapters where `isAvailable() === true`.
2. Filter to adapters that handle the requested `category` (either explicit match in `adapter.categories` or `"*"`).
3. Sort by priority (descending). Try each in order. The first adapter returning `ok: true` wins.
4. On `ok: false`, accumulate the error and continue to the next adapter.
5. If every applicable adapter fails or none exist, return an aggregated structured error listing which sources were tried and why each failed.

**Multimodal tool result:** On success, the router SHALL return a tool result containing:

1. An **image content block** carrying `result.imageBytes` with `result.imageMimeType`.
2. A **text content block** carrying `{ source, subjectId, title, imageUrl, license?, attribution?, summary? }` (NOT the bytes — those are in block 1).

**Source-namespaced `subjectId` examples:** `commons:File:Eiffel_Tower.jpg`, `wikidata:Q243`, `tmdb:m-550`, `tmdb:tv-1399`, `tmdb:p-287`, `inaturalist:46327`, `mbid:550e8400-...`, `jikan:1`, `jikan:c-1`, `openlibrary:OL27448M`, `nasa:PIA12345`, `met:436532`, `openverse:abc123`.

**Cross-source matching is NOT performed.** `tmdb:m-550` and `wikidata:Q172241` are distinct keys even if they refer to the same movie (see `find_previous_subjects` requirement in `trivia-question-search`).

**Per-adapter image fetch constraints (uniform across all adapters):**

- **Timeout**: 10 seconds for the image download. Longer downloads SHALL be aborted and the adapter SHALL return `kind: "network"`.
- **Maximum file size**: 5 MB. Larger images SHALL be rejected with `kind: "tooLarge"`.
- **Supported formats**: JPEG, PNG, WebP, GIF. The format SHALL be determined from the HTTP `Content-Type` response header (authoritative). When `Content-Type` is missing or generic, fall back to the URL's file extension. SVG and other formats SHALL be rejected with `kind: "unsupportedFormat"`.
- Adapters SHALL NOT transcode, resize, or otherwise mutate the image. `post_questions` is solely responsible for any Slack-side format adaptation at upload time.
- Adapters MUST set a descriptive `User-Agent` header and implement bounded retry-with-backoff on `429` and `503` responses.

**Commons adapter specifics (a v1-shipped adapter, normative because it's the general fallback):**

- The Commons adapter SHALL prefer `thumbnail.source` (a rasterized PNG/JPEG render) over `originalimage.source` (often an SVG master for flags, coats of arms, diagrams).
- The Commons adapter SHALL set `subjectId: "wikidata:Q<n>"` when the page summary contains a `wikibase_item`; else `subjectId: "wikipedia:<slug>"`.
- A valid JSON response from Wikipedia that lacks the expected fields SHALL be rejected with `kind: "unknown"`.

**`SourceError` discriminated union:**

```
{ kind: "notFound" | "rateLimit" | "network" | "tooLarge" | "unsupportedFormat" | "unknown" | "keyMissing", message: string }
```

Adapters whose required key is unset SHALL return `keyMissing` from `find()` (NOT throw) — the router uses this to skip the adapter cleanly without surfacing an error.

#### Scenario: Successful lookup via Commons (landmarks)

- **GIVEN** the hint `"Eiffel Tower"` and the Commons adapter is registered for category `"*"`
- **WHEN** `find_visual_subject({ game, category: "Landmarks", hint: "Eiffel Tower" })` is called
- **THEN** the router routes to the Commons adapter, which returns a multimodal result containing an image block (Eiffel Tower thumbnail PNG bytes) AND a text block with `source: "commons"`, `subjectId: "wikidata:Q243"`, `title: "Eiffel Tower"`, license + attribution

#### Scenario: Category-routed lookup via TMDB (movies)

- **GIVEN** `category: "Movies"` and TMDB is enabled with a valid key
- **AND** TMDB is registered with `categories: ["Movies", ...]` at higher priority than Commons
- **WHEN** `find_visual_subject({ game, category: "Movies", hint: "Fight Club" })` is called
- **THEN** the router routes to TMDB, which returns `source: "tmdb"`, `subjectId: "tmdb:m-550"`, `title: "Fight Club"`, and the poster image bytes — Commons is NOT consulted

#### Scenario: Opt-in source with missing key is skipped

- **GIVEN** TMDB is registered for `["Movies"]` but its API key is unset
- **WHEN** `find_visual_subject({ game, category: "Movies", hint: "..." })` is called
- **THEN** TMDB's `isAvailable()` returns false; the router skips TMDB and falls through to the next category-matching adapter (e.g., Commons) without surfacing a `keyMissing` error to Claude

#### Scenario: Flag query uses Commons thumbnail (not SVG)

- **GIVEN** `category: "Flags"`, `hint: "Flag of Ecuador"`
- **AND** Wikipedia's main image for the page is an SVG master, but `thumbnail.source` is a rasterized PNG render
- **WHEN** the Commons adapter is invoked
- **THEN** the adapter downloads `thumbnail.source` (the PNG render), passes the format check, and returns the image bytes (NOT the SVG)

#### Scenario: Primary source fails, router falls through to next

- **GIVEN** for category `"Anime"`, Jikan is registered at priority 90 and Commons at priority 50
- **AND** Jikan returns `kind: "notFound"` for the given hint
- **WHEN** the router processes the request
- **THEN** the router calls Commons next; if Commons succeeds, the response is `source: "commons"`

#### Scenario: Image too large is rejected

- **GIVEN** the chosen image is 12 MB
- **WHEN** the tool attempts to download it
- **THEN** the tool returns a structured error with `kind: "tooLarge"` so Claude can re-roll

#### Scenario: SVG rejected

- **GIVEN** the article's main image is an SVG (e.g., a coat of arms)
- **WHEN** the tool processes the candidate
- **THEN** the tool returns a structured error with `kind: "unsupportedFormat"` so Claude can re-roll

#### Scenario: No usable result from any source returns aggregated error

- **GIVEN** every applicable adapter for the requested category fails with `notFound`
- **WHEN** the router exhausts its adapter list
- **THEN** the tool returns an aggregated structured error listing each attempted source and its failure kind, so Claude can re-roll to a different subject or category

#### Scenario: Rate-limit retry inside an adapter

- **GIVEN** any adapter's upstream API returns a 429 once then a 200
- **WHEN** that adapter's `find()` is invoked
- **THEN** the adapter retries once with backoff and returns the successful response (the router never sees the 429)

#### Scenario: Content-Type used when extension is missing

- **GIVEN** the image URL has no file extension (e.g., `/wiki/Special:FilePath/Foo`)
- **AND** the HTTP response has `Content-Type: image/jpeg`
- **WHEN** the tool processes the response
- **THEN** the image is accepted as JPEG (Content-Type is authoritative)

#### Scenario: Malformed adapter response returns unknown error

- **GIVEN** an adapter's upstream API returns 200 with valid JSON but the body lacks the expected fields the adapter relies on (e.g., Commons response lacking `thumbnail.source`)
- **WHEN** the adapter processes the response
- **THEN** the adapter returns a structured error with `kind: "unknown"` and a descriptive message; the router then tries the next adapter

#### Scenario: Download timeout treated as network failure

- **GIVEN** the image download does not complete within 10 seconds
- **WHEN** the tool's download phase times out
- **THEN** the tool returns a structured error with `kind: "network"`

#### Scenario: 5xx server errors retried then surface as network

- **GIVEN** the Wikipedia REST API returns a 500 (or 502/504) response, and a retry also returns 5xx
- **WHEN** the tool exhausts its bounded retry budget on the 5xx response
- **THEN** the tool returns a structured error with `kind: "network"` and a descriptive message indicating the upstream 5xx, so Claude can re-roll to a different candidate

### Requirement: Claude inspects the image before writing the question

The visual research subflow in the question-posting prompt SHALL include an **image inspection gate** that runs after `find_visual_subject` returns and before any statement is written. The gate evaluates the inline image returned by the tool on four checks:

1. **Subject match.** Does the image depict the subject named in the metadata? (Wikipedia main images are occasionally diagrams, coats of arms, maps, or tangentially-related photos rather than canonical subject depictions.)
2. **Subject clarity.** Is the subject clearly visible without heavy obstruction or competing subjects? Is the angle, scale, and quality sufficient for a player to recognize or evaluate it?
3. **Answer leakage.** Does the image contain text, captions, watermarks, labels, or any other in-image content that reveals the answer?
4. **Distinguishing features.** What is visually evident in the image that can inform distractor choice (for choice template) or identity-swap selection (for boolean claim template)?

If checks (1), (2), or (3) fail, Claude SHALL re-roll the research subflow — either by calling `find_visual_subject` with a different candidate subject or by moving to a different category from `categories.ideas`. The failure is silent (no tool error) — same pattern as the duplicate-detection step.

**Retry budget**: up to 3 candidate re-rolls within the same category, then up to 2 category re-rolls (moving to a different entry in `categories.ideas`). When all attempts are exhausted, the visual path SHALL abort and re-roll the entire `get_ideas` call once. The re-roll MAY yield `suggestedPromptMedium: "text"`, which is the expected graceful-degradation outcome (a text question instead of failing the cron fire entirely).

The observations from check (4) SHALL be carried forward into the statement-writing step (the choice path uses them for distractor selection; the boolean claim path uses them for identity-swap selection or image-grounded property selection).

#### Scenario: Subject-mismatch image triggers re-roll

- **GIVEN** Claude requested an image for "Eiffel Tower" via `find_visual_subject`
- **AND** the Wikipedia main image is a 19th-century engineering diagram, not a photograph of the tower
- **WHEN** Claude inspects the inline image
- **THEN** Claude judges subject-match failed (the engineering diagram is not what players will recognize as the Eiffel Tower) and re-rolls

#### Scenario: Image with text overlay triggers re-roll

- **GIVEN** Claude requested an image for "Cardinal" and the returned image has the caption "Northern Cardinal" baked into the lower-right corner
- **WHEN** Claude inspects the image
- **THEN** Claude judges answer-leakage failed and re-rolls

#### Scenario: Clean image passes inspection and informs statement

- **GIVEN** Claude requested an image for "Capybara" and the returned image is a clear photo of a single capybara on a grassy bank
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

### Requirement: post_questions performs Slack file re-hosting for image media

When `post_questions` processes an item whose loaded question has `media` set and `media.slackFileId` is unset, the tool SHALL:

1. Download the image at `media.url` via HTTPS.
2. Upload it to Slack via `files.uploadV2` with a neutral filename `trivia-q-<questionId>.<ext>` and the game's configured `channels`.
3. Stamp `media.slackFileId` (and an associated Slack-hosted URL) on the question record before posting.
4. Use the Slack-hosted URL as the `hero_image.image_url` in the rendered card.

When `media.slackFileId` is already set, the tool SHALL skip the upload and reuse the stored Slack URL. When download or upload fails, the tool SHALL surface a per-item error and SHALL NOT stamp `postedAt` for that item.

The Slack-hosted URL SHALL be the image surfaced in Slack link unfurls and previews — the upstream Wikipedia/Commons URL SHALL NOT appear in any user-facing surface after `post_questions` completes.

#### Scenario: First post uploads to Slack

- **GIVEN** a saved question with `media.url` set and `media.slackFileId` unset
- **WHEN** `post_questions` processes the item
- **THEN** the image is downloaded, re-uploaded with the neutral filename, `media.slackFileId` is stamped, and the card's `hero_image.image_url` is the Slack-hosted URL

#### Scenario: Re-post reuses existing Slack file

- **GIVEN** a saved question with `media.slackFileId` already stamped
- **WHEN** `post_questions` processes the item
- **THEN** no upload happens; the existing Slack file URL is reused in the rendered card

#### Scenario: Upload failure prevents posting

- **GIVEN** a saved question with media, where `files.uploadV2` returns an error
- **WHEN** `post_questions` processes the item
- **THEN** the item's result is `{ ok: false, error: ... }`, `postedAt` is NOT stamped, and the next call can retry

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
