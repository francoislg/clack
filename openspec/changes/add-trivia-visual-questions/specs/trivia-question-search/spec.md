## MODIFIED Requirements

### Requirement: save_question validates promptMedium and media

The `save_question` tool SHALL accept two new optional input fields:

- `promptMedium: "text" | "image"` — when absent, the stored record is stamped with `"text"` (the new default).
- `media: { kind: "image", url, altText, subjectId, title, license?, attribution? }` — required when `promptMedium === "image"`, forbidden when `promptMedium === "text"`.

The tool SHALL enforce these constraints at the boundary:

1. **Media required-when-image**: when `promptMedium === "image"`, `media` MUST be present and MUST contain non-empty `url`, `altText`, `subjectId`, and `title` strings, with `kind === "image"`. The tool SHALL reject calls missing or partial.
2. **Media forbidden-when-text**: when `promptMedium === "text"` (or absent), `media` MUST NOT be set. The tool SHALL reject calls that pass `media` without `promptMedium: "image"`.
3. **URL hygiene**: `media.url` MUST be an HTTPS URL. The tool SHALL reject http:// and non-URL strings.
4. **altText content**: `media.altText` MUST be a non-empty string ≤ 2000 characters. It MUST NOT contain Block Kit markup (`*bold*`, `<@USERID>` mentions, channel pings) — text only, newlines permitted. The tool SHALL strip any Block Kit markup it finds before storing (defense-in-depth; the prompt should not be producing such content for altText).

The tool SHALL NOT impose any cross-axis constraint between `promptMedium` and `answersFormat`. All six combinations (`{text, image} × {boolean, choice, freeform}`) are valid and SHALL save successfully when the per-axis field validation passes. The freeform `expectedAnswer` field SHALL be permitted alongside `media` when `answersFormat: "freeform"` and `promptMedium: "image"` are both set.

When validation passes, the stored record SHALL carry `promptMedium` (always, including when `"text"` for new writes) and `media` (when `promptMedium === "image"`).

#### Scenario: Image + choice + media saves successfully

- **WHEN** `save_question` is called with `promptMedium: "image"`, `answersFormat: "choice"`, valid `media`, and the other required choice fields
- **THEN** the question is saved with `promptMedium`, `media`, and the choice answer key

#### Scenario: Image + boolean + media saves successfully

- **WHEN** `save_question` is called with `promptMedium: "image"`, `answersFormat: "boolean"`, `isTrue: true`, and a valid `media` object
- **THEN** the question is saved with `promptMedium`, `media`, and `isTrue`

#### Scenario: Image + freeform + media saves successfully

- **WHEN** `save_question` is called with `promptMedium: "image"`, `answersFormat: "freeform"`, `expectedAnswer: "Capybara"`, optional `acceptableAnswers: ["Hydrochoerus hydrochaeris"]`, and a valid `media` object
- **THEN** the question is saved with `promptMedium`, `media`, `expectedAnswer`, and `acceptableAnswers`

#### Scenario: Image without media is rejected

- **WHEN** `save_question` is called with `promptMedium: "image"` and no `media` argument
- **THEN** the tool returns an error explaining that media is required for image medium

#### Scenario: Text with media is rejected

- **WHEN** `save_question` is called with `promptMedium: "text"` (or absent) AND a `media` argument
- **THEN** the tool returns an error explaining that media is only allowed on image medium

#### Scenario: Non-HTTPS media URL is rejected

- **WHEN** `save_question` is called with `media.url: "http://example.com/image.jpg"` (or anything not starting with `https://`)
- **THEN** the tool returns an error requiring HTTPS

## ADDED Requirements

### Requirement: find_previous_subjects exact-match dedup tool

The system SHALL expose a `find_previous_subjects({ game, subjectId, season? })` MCP tool that returns saved questions whose `media.subjectId` equals the argument. The tool SHALL accept `season: "all" | "current" | "<slug>"` with the same semantics as `find_previous_questions` (`"all"` is the default).

The response shape SHALL be:

```
{ matches: Array<{ id, statement, createdAt, postedAt?, processedAt?, media: { title, subjectId } }>, count }
```

The response SHALL NOT include any answer-key fields (`correctIndex`, `isTrue`). The response SHALL NOT include `media.url`. The tool SHALL be available to the same role tier as `find_previous_questions`.

**Subject-ID matching is exact-string, with no normalization across formats.** The two `subjectId` schemes (`wikidata:Q<n>` preferred, `wikipedia:<slug>` fallback) are treated as distinct keys: a record stored with `wikidata:Q243` does NOT match a query for `wikipedia:Eiffel_Tower` even when they refer to the same real-world subject. Cross-format unification is intentionally NOT performed — Wikipedia page renames make slug-to-QID mapping non-stable over time, and an attempted normalization layer would silently drop dedup signal when the mapping drifts. Callers SHOULD pass the QID form whenever the source data has it; the `wikipedia:` fallback exists only for pages without a QID.

#### Scenario: Exact subjectId hit

- **GIVEN** a saved question with `media.subjectId: "wikidata:Q243"`
- **WHEN** `find_previous_subjects({ game, subjectId: "wikidata:Q243" })` is called
- **THEN** that question appears in `matches`

#### Scenario: No matches returns empty list

- **WHEN** the subjectId is not present on any saved question
- **THEN** the response is `{ matches: [], count: 0 }`

#### Scenario: Legacy questions without media are excluded

- **GIVEN** a game has questions saved before this change (no `media` field)
- **WHEN** `find_previous_subjects` runs
- **THEN** legacy records do not appear in `matches` regardless of the subjectId argument

#### Scenario: Malformed media field is treated as no media

- **GIVEN** a saved question whose `media` field is `null`, `{}`, or otherwise missing required keys (no `subjectId`)
- **WHEN** `find_previous_subjects` runs
- **THEN** the malformed record is silently excluded from `matches` (same treatment as legacy no-media records); the tool does NOT error on malformed data

#### Scenario: Cross-format subjectId does NOT match

- **GIVEN** a saved question with `media.subjectId: "wikidata:Q243"` (the Eiffel Tower's Wikidata QID)
- **WHEN** `find_previous_subjects({ game, subjectId: "wikipedia:Eiffel_Tower" })` is called
- **THEN** the query does NOT match (the two formats are distinct keys by design); the saved question does NOT appear in `matches`

#### Scenario: Season filter scopes the search

- **GIVEN** the same subjectId appears in questions from two different seasons
- **WHEN** `find_previous_subjects({ ..., season: "current" })` is called
- **THEN** only matches from the current season are returned
