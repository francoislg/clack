## ADDED Requirements

### Requirement: image-medium questions MUST be about the image

For any question saved with `promptMedium: "image"`, the question's content SHALL be such that *removing the image would render the question unanswerable or fundamentally different*. The image SHALL be the primary referent of the question — not illustration, decoration, or visual support for a text-based fact. The prompt SHALL enforce this via an explicit gate (the "image-is-question gate") that runs before the polarity, plausibility, and difficulty gates.

Acceptable shapes:

- **Identification questions**: "Who is this?", "What animal is this?", "Which landmark is shown?" — unanswerable without the image.
- **Identity claims**: "This is the flag of Ecuador. T/F" — requires looking at the image to evaluate against memory.
- **Image-grounded property claims**: "This bird species is native to Europe. T/F" (shown a Cardinal) — requires identifying the bird from the image, then evaluating the property against that identification.

Rejected shapes (gate failures):

- **Decorative-image questions**: "Birds have hollow bones. T/F" with a bird photo — answer is unchanged regardless of which bird is shown.
- **Unrelated-image questions**: "The capital of France is Paris. T/F" with an Eiffel Tower photo — image is rhetorical.
- **Category-level facts**: any claim about the broader category (birds in general, flags in general) rather than the specific subject in the image.

This requirement is enforced *in the prompt* (Claude self-evaluates against the gate during the question-writing flow). The storage layer does NOT enforce it — content quality requires reading the statement against the image, which only Claude can do at generation time.

#### Scenario: Identification claim passes the gate

- **GIVEN** the prompt writes "Who is this?" with a photo of a person
- **WHEN** the image-is-question gate runs
- **THEN** the gate passes (removing the image makes the question unanswerable)

#### Scenario: Identity-swap claim passes the gate

- **GIVEN** the prompt writes "This is the flag of Colombia. T/F" with an image of Ecuador's flag
- **WHEN** the image-is-question gate runs
- **THEN** the gate passes (evaluating requires looking at the flag in the image)

#### Scenario: Image-grounded property claim passes the gate

- **GIVEN** the prompt writes "This bird species is native to Europe. T/F" with a photo of a Cardinal
- **WHEN** the image-is-question gate runs
- **THEN** the gate passes (the player must first identify the bird from the image to evaluate the geographic claim)

#### Scenario: Decorative-image claim fails the gate

- **GIVEN** the prompt writes "Birds have hollow bones. T/F" with a photo of any bird
- **WHEN** the image-is-question gate runs
- **THEN** the gate fails — the claim's truth is independent of which bird is shown — and Claude rewrites the question

#### Scenario: Unrelated-image claim fails the gate

- **GIVEN** the prompt writes "The capital of France is Paris. T/F" with a photo of the Eiffel Tower
- **WHEN** the image-is-question gate runs
- **THEN** the gate fails — the image is rhetorical and removing it leaves the question unchanged

## MODIFIED Requirements

### Requirement: per-question generation dispatches on a 3-axis matrix

The scheduled question-posting prompt SHALL dispatch each question's generation flow on the cross-product of three independently-rolled axes from `get_ideas`: `suggestedAnswersFormat × suggestedQuestionType × suggestedPromptMedium`. The matrix has 12 active cells (3 × 2 × 2):

```
                              promptMedium: text          promptMedium: image
                       ┌───────────────────────────┬──────────────────────────────┐
   fact + boolean      │ existing fact+text+bool   │  NEW visual+fact+bool        │
                       ├───────────────────────────┼──────────────────────────────┤
   fact + choice       │ existing fact+text+choice │  NEW visual+fact+choice      │
                       ├───────────────────────────┼──────────────────────────────┤
   fact + freeform     │ existing fact+text+free   │  NEW visual+fact+freeform    │
                       ├───────────────────────────┼──────────────────────────────┤
   topical + boolean   │ topical+text+bool         │  NEW visual+topical+bool     │
                       ├───────────────────────────┼──────────────────────────────┤
   topical + choice    │ topical+text+choice       │  NEW visual+topical+choice   │
                       ├───────────────────────────┼──────────────────────────────┤
   topical + freeform  │ topical+text+freeform     │  NEW visual+topical+freeform │
                       └───────────────────────────┴──────────────────────────────┘
```

The 6 text-medium paths SHALL be unchanged from the topical and freeform proposals. The 6 new image-medium paths SHALL share a common `VISUAL_RESEARCH_SUBFLOW` for *subject discovery* (pick a category from `categories.ideas` (the standard pool — same source as text medium) → brainstorm candidates → pick an available `*_image_search__*` MCP tool matching the category → call it with `query: <candidate>` → image inspection gate → `find_previous_subjects` dedup loop), then diverge on statement-writing based on `answersFormat`. When no `*_image_search__*` tool is installed, the visual research subflow short-circuits and the prompt falls back to the text-medium path for the same `answersFormat × questionType`.

- **Image + choice (`visual+*+choice`)**: use an *identification template* — write an identification prompt ("Who is this?", "What landmark?", etc.), place the subject's title at `suggestedCorrectIndex`, write N-1 same-category-sibling distractors, then run the choice path's distractor plausibility gate.
- **Image + boolean (`visual+*+boolean`)**: use a *claim template* — write a statement asserting an identity or property about the image ("This is the flag of Ecuador."). When the rolled `suggestedAnswer === false`, the strongest claims swap to a *confusable* subject (e.g., a similar-looking flag) rather than a random wrong identity. Run the boolean path's polarity self-check gate.
- **Image + freeform (`visual+*+freeform`)**: use a *typed-identification template* — write a templated prompt ("Who is this?", "What animal is this?", "Which landmark is shown?"). Set `expectedAnswer` to the subject's title from the image-search tool's metadata block (`title` field). Optionally populate `acceptableAnswers` with observed variants. No polarity gate, no plausibility gate (no distractors to score, no polarity to flip).

The `topical` variants of all three templates SHALL additionally run WebSearch to anchor the subject in a recent event and SHALL save both `media` AND `sourceUrl` (plus optional `eventDate`).

In all 6 visual paths, the duplicate-detection step SHALL call `find_previous_subjects({ subjectId })` to catch subject-level duplicates. The image+boolean variants SHALL perform a **required dual-check**: in addition to `find_previous_subjects`, they SHALL call `find_previous_questions` against the *claim text* (e.g., "This is the flag of Ecuador") with statement-similarity matching. Re-roll if either check hits (AND-combined: both must miss). Image+choice and image+freeform variants SHALL NOT perform statement-text dedup — their templated prompts ("Who is this?", "What animal is this?") would always match, producing false positives.

For image+boolean, when the visual research subflow returns a subject with no plausible confusable sibling in the category (e.g., a uniquely-identifiable landmark like the Eiffel Tower with no lookalike), the boolean claim template SHALL fall back to an *image-grounded property claim* — a true/false claim about a property of the depicted subject that requires identifying the subject from the image to evaluate (e.g., "This landmark is located in Italy. T/F" with an Eiffel Tower photo). Identity-swap is preferred when a clear confusable exists; the image-grounded property fallback exists for unique-subject cases.

#### Scenario: Visual fact choice path generates an image-medium identification question

- **GIVEN** `get_ideas` returns `suggestedPromptMedium: "image"`, `suggestedAnswersFormat: "choice"`, `suggestedQuestionType: "fact"`
- **WHEN** Claude runs the question-posting flow
- **THEN** it follows the visual+fact+choice path: picks a category, finds a subject, dedup-checks via `find_previous_subjects`, writes the identification prompt + choices, and saves with `promptMedium: "image"`, `answersFormat: "choice"`, and `media`

#### Scenario: Visual fact boolean path generates a claim question

- **GIVEN** `get_ideas` returns `suggestedPromptMedium: "image"`, `suggestedAnswersFormat: "boolean"`, `suggestedQuestionType: "fact"`, `suggestedAnswer: false`
- **WHEN** Claude runs the question-posting flow
- **THEN** it follows the visual+fact+boolean path: picks a category, finds a subject, writes a claim statement asserting a *confusable* subject's identity (swap), runs the polarity self-check, and saves with `promptMedium: "image"`, `answersFormat: "boolean"`, `isTrue: false`, and `media`

#### Scenario: Visual topical paths produce questions with media AND sourceUrl

- **GIVEN** `get_ideas` returns `suggestedPromptMedium: "image"`, `suggestedQuestionType: "topical"` (for either answersFormat)
- **WHEN** Claude runs the question-posting flow
- **THEN** the saved record carries `media`, `sourceUrl`, and `promptMedium: "image"` — and the duplicate-detection step used `find_previous_subjects`

#### Scenario: Image+boolean for a unique subject falls back to property claim

- **GIVEN** the visual research subflow returns the Eiffel Tower (a uniquely-identifiable landmark with no clear confusable sibling)
- **AND** `suggestedAnswer === false`
- **WHEN** Claude writes the claim
- **THEN** Claude writes an image-grounded property claim that is false (e.g., "This landmark is located in Italy. T/F") rather than an identity swap, because no plausible confusable identity exists for this subject

#### Scenario: Visual fact freeform path generates a typed-identification question

- **GIVEN** `get_ideas` returns `suggestedPromptMedium: "image"`, `suggestedAnswersFormat: "freeform"`, `suggestedQuestionType: "fact"`
- **WHEN** Claude runs the question-posting flow
- **THEN** it follows the visual+fact+freeform path: picks a category, selects an available `*_image_search__*` tool matching the category, calls it for a subject, dedup-checks via `find_previous_subjects` (NOT `find_previous_questions`), writes a templated identification prompt, sets `expectedAnswer` to the subject's title from the tool's metadata block, and saves with `promptMedium: "image"`, `answersFormat: "freeform"`, `media`, and `expectedAnswer`

#### Scenario: Visual topical freeform combines media, sourceUrl, and expectedAnswer

- **GIVEN** `get_ideas` returns `suggestedPromptMedium: "image"`, `suggestedAnswersFormat: "freeform"`, `suggestedQuestionType: "topical"`
- **WHEN** Claude runs the question-posting flow
- **THEN** the saved record carries `media`, `sourceUrl`, `eventDate`, `expectedAnswer`, and `promptMedium: "image"`; reveal-time validation uses the existing freeform Haiku judge against `expectedAnswer` + `acceptableAnswers`

### Requirement: post_questions re-hosts images on Slack before posting

When `post_questions` processes an item whose loaded question has `media` set and `media.slackFileId` is unset, the tool SHALL:

1. Download the image at `media.url` via HTTPS. The download SHALL be bounded by a 15-second timeout; on timeout the tool SHALL surface a per-item error and continue to the next item. The downloaded content SHALL be a supported raster format — JPEG, PNG, WebP, or GIF (determined from the response `Content-Type` header, falling back to the URL extension). SVG and other unsupported types SHALL surface a per-item error rather than being uploaded. (`post_questions` re-fetches `media.url` here, independently of the image-search plugin's inspection-time download, so this is trivia's own format gate before the Slack upload.)
2. Upload the bytes to Slack via `files.uploadV2` with `filename: "trivia-q-<questionId>.<ext>"` and the game's configured `channels` parameter. `<ext>` SHALL be derived from the detected `Content-Type` (e.g., `image/jpeg` → `jpg`, `image/png` → `png`), falling back to the upstream URL's extension when present, else `jpg`.
3. Stamp `media.slackFileId` on the question record (and the associated Slack-hosted URL) before posting the question card.
4. Substitute the Slack-hosted URL into the rendered `card.hero_image.image_url` (the prompt builds the card with a placeholder; `post_questions` performs the rewrite — OR equivalent shared seam — documented in the implementation).

When `media.slackFileId` is already set, the tool SHALL skip the upload and reuse the stored Slack URL.

When the download or upload fails:

- The tool SHALL surface a per-item error in the `results` array.
- The tool SHALL NOT stamp `postedAt` or `messageLink` on the question.
- Subsequent re-runs SHALL be able to retry the upload.

#### Scenario: First-time post performs the upload

- **GIVEN** a saved question with `media.url` set, `media.slackFileId` unset
- **WHEN** `post_questions` processes the item
- **THEN** the image is downloaded, re-uploaded with the neutral filename, `media.slackFileId` is persisted, the card uses the Slack URL, and the message is posted

#### Scenario: Re-post idempotent skip

- **GIVEN** a saved question with `media.slackFileId` already stamped (e.g., a replay)
- **WHEN** `post_questions` processes the item
- **THEN** no upload happens and the existing Slack URL is reused

#### Scenario: Download failure prevents posting

- **GIVEN** the upstream `media.url` returns a 404
- **WHEN** `post_questions` processes the item
- **THEN** the result is `{ ok: false, error: <download-failed> }`, `postedAt` is NOT stamped, and the next call can retry

#### Scenario: Upload failure prevents posting

- **GIVEN** the upstream image downloads successfully but `files.uploadV2` returns an error
- **WHEN** `post_questions` processes the item
- **THEN** the result is `{ ok: false, error: <upload-failed> }`, `postedAt` is NOT stamped, and the next call can retry

#### Scenario: Permanent upload failure (4xx) leaves the item recoverable

- **GIVEN** the upstream image downloads successfully but `files.uploadV2` returns a 4xx error (e.g., authentication failure, quota exceeded — not transient)
- **WHEN** `post_questions` processes the item
- **THEN** the result is `{ ok: false, error: <details from the 4xx response> }`, `postedAt` and `slackFileId` are NOT stamped, the error is logged at warn level, and the item remains eligible for manual retry (no permanent failure marker is set)

#### Scenario: Unsupported image format rejected before upload

- **GIVEN** a saved question whose `media.url` resolves to an SVG (or any non-raster type) — e.g., a misbehaving image-search plugin stored an SVG URL, or the upstream URL now resolves to one
- **WHEN** `post_questions` downloads it and inspects the `Content-Type`
- **THEN** the result is `{ ok: false, error: <unsupported-format detail> }`, the bytes are NOT uploaded to Slack, `postedAt` and `slackFileId` are NOT stamped, and the item remains eligible for retry

#### Scenario: Slack workspace file quota exhausted

- **GIVEN** the Slack workspace's file-storage quota is at the cap
- **AND** `files.uploadV2` returns a 4xx error indicating quota exhaustion
- **WHEN** `post_questions` processes the item
- **THEN** the result is `{ ok: false, error: <quota-exhausted detail> }`, the error is logged at warn level (so admins can detect it in logs), `postedAt` and `slackFileId` are NOT stamped, and the item remains eligible for retry after the admin frees workspace storage

### Requirement: question card includes hero_image for image-medium questions

For image-medium questions, the rendered `card` block SHALL include a `hero_image: { type: "image", image_url: <slack-hosted-url>, alt_text: <truncated-altText> }`. The injection happens entirely inside `post_questions` — the prompt does NOT construct a `hero_image` block; the card produced by the prompt has only `title`, `body`, and optional `subtitle`. After the Slack upload hop, `post_questions` mutates the card to add `hero_image` with the Slack-hosted URL.

The `alt_text` SHALL be `media.altText` truncated to 2000 characters (Slack Block Kit's `alt_text` limit). The stored `media.altText` value MAY be longer; truncation happens at injection time only and does NOT mutate the stored record.

The card's `title` SHALL still be the category line ("📷 Famous People", etc.). The card's `body` SHALL still carry the question prompt + (for choice) numbered options layout, unchanged from text-medium choice questions.

For image+freeform questions, the card SHALL ALSO carry the `[Answer]` button (action_id `plugin:trivia:freeform-answer:<questionId>`) injected by the existing freeform flow in `post_questions`. Both the hero_image injection (from this proposal) and the `[Answer]` button injection (from the freeform proposal) happen in the same `post_questions` hook and are composable — image+freeform cards end up with both. The rendering order SHALL be: `hero_image` first (top, visual prominence so users orient to the subject before reading), then the card's `title` and `body`, then the `[Answer]` button at the bottom (in the natural action-after-reading position).

The question card SHALL NOT include attribution at posting time (attribution is rendered on reveal — see the visual-questions capability).

#### Scenario: Image-medium card has hero_image

- **WHEN** an image-medium question is rendered for posting
- **THEN** its card block has `hero_image` populated with the Slack URL and altText

#### Scenario: Text-medium card has no hero_image

- **WHEN** a text-medium question is rendered for posting
- **THEN** the card block does NOT include a `hero_image` field (today's behavior, unchanged)

### Requirement: reveal renders attribution context block for image media

When `process_reveal_answers` returns a reveal entry whose question has `media`, the rendered reveal Block Kit SHALL include exactly one extra `context` block above the closer. The block SHALL contain:

- `"📷 Image: <attribution> · <license>"` when both `media.attribution` and `media.license` are present, OR
- `"📷 Image: <attribution>"` when only attribution is present, OR
- be omitted entirely when neither is present.

**Positioning:**

- In a single-question reveal, the attribution block SHALL appear after the voter-bucket sections and before the closer `context` block that introduces the leaderboard.
- In a multi-question reveal, each question's attribution block SHALL appear immediately after that question's compact verdict `section` block (before the `divider` that separates verdicts from the Round Summary). Each image-medium question carries its own attribution block, in question order. The cumulative-leaderboard closer remains last.

#### Scenario: Reveal with attribution and license

- **GIVEN** a reveal entry has `media: { title: "Eiffel Tower", attribution: "Photo by Alice", license: "CC-BY-SA-4.0" }`
- **WHEN** the reveal is rendered
- **THEN** the rendered blocks include a `context` block with text `"📷 Image: Photo by Alice · CC-BY-SA-4.0"`

#### Scenario: Reveal without attribution skips the block

- **GIVEN** a reveal entry has `media` but `attribution` and `license` are both absent
- **WHEN** the reveal is rendered
- **THEN** no attribution `context` block is included

#### Scenario: Multi-question reveal with multiple image-medium questions

- **GIVEN** a 3-question reveal where Q1 and Q3 are image-medium (both have `media` with attribution) and Q2 is text-medium
- **WHEN** the reveal is rendered
- **THEN** Q1's compact verdict section is immediately followed by Q1's attribution context block, then Q2's verdict section (no attribution block), then Q3's verdict section followed by Q3's attribution context block, then the divider, then the Round Summary, then the cumulative-leaderboard closer
