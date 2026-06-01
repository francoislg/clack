## REMOVED Requirements

### Requirement: post_questions re-hosts images on Slack before posting

**Reason:** The Slack re-hosting hop is the cause of the visual-questions outage — it threw `files.uploadV2 returned no file id` (wrong response path), and its `channel_id` upload posted stray card-less images to the channel as a side effect. Replaced by direct public-URL rendering (see the ADDED requirement below). Re-hosting may return as a future leak-proofing change, done correctly.

## MODIFIED Requirements

### Requirement: image-medium questions carry a Claude-built image block

For image-medium questions, the question-generation prompt SHALL build a Block Kit `image` block — `{ type: "image", image_url: <media.url>, alt_text: <media.altText> }` — directly into the `blocks` array it hands to `post_questions`, positioned immediately AFTER the question `card` block. The `image_url` SHALL be the upstream public URL stored on the record (`media.url`) — Slack fetches and renders it directly.

`post_questions` SHALL be medium-agnostic: it posts whatever blocks it is given, appends the per-format answer buttons, and SHALL NOT inject, move, download, re-upload, or otherwise re-host any image, and SHALL NOT set `channel_id` on any file API. It does NOT compensate for a missing image block.

For image+freeform questions, the message ALSO carries the `[Answer]` button (action_id `plugin:trivia:freeform-answer:<questionId>`) appended by the existing freeform flow; the per-question block order is `card` → `image` → … → `actions` (buttons).

The card's `title` SHALL still be the category line; the card's `body` SHALL still carry the question prompt. Attribution is NOT shown at post time (it renders on reveal — see the visual-questions capability).

#### Scenario: Claude-built image block is posted unchanged

- **GIVEN** an image-medium question whose supplied `blocks` include an `image` block with `image_url` = `media.url`, placed after the card
- **WHEN** `post_questions` processes the item
- **THEN** the posted message contains exactly that one `image` block (untouched, in its supplied position), the message is posted exactly once, and `post_questions` adds no image block of its own

#### Scenario: post_questions does not inject an image block

- **WHEN** `post_questions` processes any item — image-medium or text-medium
- **THEN** it posts exactly the supplied blocks (plus the appended answer buttons) and never injects an `image` block; an image-medium question whose blocks omit the image block is posted without one (no compensation)
