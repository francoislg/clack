## Why

Visual trivia questions don't post. In the first live run (image-medium enabled on `season-2026-06`), the cron generated 4 questions correctly but only the one text question landed — all 3 image questions failed with `files.uploadV2 returned no file id`, and each failed attempt still dumped a bare, card-less image into the channel. With Claude's retries that produced ~9 stray duplicate images and a single real question.

Root cause is the Slack **re-hosting hop** added in `add-trivia-visual-questions`. `post_questions` downloads `media.url`, re-uploads it via `files.uploadV2`, and tries to reference the uploaded file in the card's `hero_image`. That path is broken three ways:

1. **Wrong response shape** — the file id lives at `result.files[0].files[0].id`, not `result.files[0].id`, so the hop always throws "no file id" and the card never posts.
2. **`channel_id` side-effect** — `files.uploadV2({ channel_id })` shares the uploaded file to the channel as its own message *before* the throw, so every failed attempt still posts a stray image. Retries multiply it.
3. **`image_url` can't render a private file** — even with (1) and (2) fixed, a Block Kit `image` block's `image_url` must be publicly fetchable; a Slack `url_private`/permalink won't render (it needs a `slack_file: { id }` reference instead).

The original design intent — surface the image by **URL** — was correct. The MCP limitation that forced data-mode (base64) applies ONLY to the image-search *tool result* (Claude's inline inspection block); it never applied to Slack rendering. The plugin's metadata block already carries the public `imageUrl` (Wikipedia/Commons thumbnails are public HTTPS), and Block Kit `image` blocks render public URLs directly. The re-host was unnecessary complexity that broke the feature.

## What Changes

- **`post_questions` stops re-hosting images on Slack.** Remove the download → `files.uploadV2` → `hero_image`-injection hop and the `fetchImage` / `uploadImage` deps entirely. `post_questions` becomes **medium-agnostic** — it posts whatever blocks it is given and appends the answer buttons; it never injects, moves, or re-hosts an image.
- **The question-generation prompt builds the image block.** For image-medium questions Claude emits a Block Kit `image` block (`{ type: "image", image_url: media.url, alt_text: media.altText }`) directly into the `blocks` it hands to `post_questions`, placed below the card. This makes the image "like every other block" — built by the prompt, validated by `validateBlocks`, posted as-is — and lets the layout (placement, surrounding context) stay under prompt control.
- **`promptMedium` + `media` are surfaced by the tools that read question records** — `find_previous_questions` (critically, the staged-pool reader the prep→post split relies on) and `get_question_history`. Without this the posting run couldn't see that a staged question is image-medium, nor get the URL to build the block.
- **Drop the now-dead `media.slackFileId` / `media.slackFileUrl` fields** from `QuestionMedia` (no upload → nothing to stamp). Records already written with them read harmlessly.
- **Accepted tradeoff (documented):** the upstream filename is visible on hover/unfurl (e.g. `Flag_of_Ecuador…png`), which can hint the answer — the leak the re-host was meant to prevent. This is accepted for now in exchange for a working feature; a future change can reintroduce leak-proofing done correctly (upload **without** `channel_id`, reference via `slack_file: { id }`). The original `add-trivia-visual-questions` "mandatory Slack re-hosting" decision is reversed by this change.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `trivia-question-posting`: replace the "post_questions re-hosts images on Slack before posting" + "hero_image references the Slack-hosted URL" requirements with "image-medium questions carry a Claude-built `image` block pointing at the public `media.url`, below the card; `post_questions` is medium-agnostic and injects nothing." Remove the upload-hop failure/idempotency scenarios.
- `trivia-visual-questions`: the `media` field shape drops `slackFileId` / `slackFileUrl`; the rendering note reflects that the prompt builds the image block from the public `media.url` and `post_questions` posts it as-is.
- `trivia-question-search`: `find_previous_questions` (and `get_question_history`) surface `promptMedium` + `media` on returned rows so the prep→post split can rebuild the image block.

## Impact

- **Code:** `src/plugins/trivia/tools/questions/postQuestions.ts` (remove `fetchImage`/`uploadImage` from `PostQuestionsSlackDeps` + default impl + the per-item upload hop + all image-specific logic — the tool becomes medium-agnostic); `src/plugins/trivia/core/types.ts` (drop `slackFileId`/`slackFileUrl` from `QuestionMedia`); `src/plugins/trivia/prompts/scheduledPrompts.ts` (the card-build step now instructs Claude to build the `image` block; visual-path notes reworded to present facts); `src/plugins/trivia/tools/questions/findPreviousQuestions.ts` + `getQuestionHistory.ts` (surface `promptMedium` + `media`); `src/plugins/trivia/domain/mediaJson.ts` (new helper projecting `QuestionMedia` → `JsonValue`).
- **Tests:** rewrite the `post_questions` image tests (medium-agnostic passthrough: a Claude-built image block posts unchanged exactly once; no injection); add `find_previous_questions` coverage for the surfaced fields; add `mediaJson` unit tests; update the visual prompt test to assert the build instruction.
- **No data migration.** Legacy records carrying `slackFileId`/`slackFileUrl` are simply ignored.
- **No new dependencies.** Removes the only `files.uploadV2` caller in the trivia plugin.
- **User-visible:** image questions now actually post — one card with its image below it — and the duplicate-image flood is gone.
