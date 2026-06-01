## REMOVED Requirements

### Requirement: post_questions performs Slack file re-hosting for image media

**Reason:** Re-hosting via `files.uploadV2` broke image-question posting (wrong response-shape id lookup, `channel_id` side-effect posting stray images, and `image_url` being unable to render a private Slack file). Replaced by direct public-URL rendering in `trivia-question-posting`. The anti-leak intent is deferred to a future change. Note the image-search MCP tool result still returns the image **as base64 data** so Claude can visually inspect it during generation — only the post-time *re-hosting* is removed; the public `imageUrl` from the tool's metadata block is what Slack renders.

## MODIFIED Requirements

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
