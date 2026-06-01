## 1. Remove the upload-only media fields

- [x] 1.1 In `src/plugins/trivia/core/types.ts`, remove `slackFileId?` and `slackFileUrl?` from the `QuestionMedia` interface (no writer/reader remains). Update the doc comments to describe direct-URL rendering.

## 2. post_questions: medium-agnostic, drop re-hosting

- [x] 2.1 Remove `fetchImage` and `uploadImage` from the `PostQuestionsSlackDeps` interface and from `defaultPostQuestionsSlackDeps`.
- [x] 2.2 Delete the per-item upload hop and the now-unused MIME/ext helpers (`SUPPORTED_IMAGE_MIME`, `SUPPORTED_IMAGE_EXTS`, `IMAGE_FETCH_TIMEOUT_MS`, `extFromUrl`, `resolveImageExt`).
- [x] 2.3 Remove ALL image-specific logic from `post_questions` — it posts the supplied blocks + appended buttons as-is, never injecting or moving an image block. (No `hero_image`, no URL-render injection, no `isRenderableImageUrl`.)
- [x] 2.4 Remove the `media: mediaToStamp` write from the `updateQuestion` call. `postedBlocks` continues to capture the full posted block array (now including any Claude-built image block).
- [x] 2.5 Strip image-medium references from the tool DESCRIPTION and the `blocks` field describe — `post_questions` is medium-agnostic, so it does not document image handling.

## 3. Surface promptMedium + media on record-reading tools

- [x] 3.1 Add a `mediaToJson` helper (`src/plugins/trivia/domain/mediaJson.ts`, + unit test) projecting `QuestionMedia` → `JsonValue` (closed interface isn't directly assignable).
- [x] 3.2 `find_previous_questions` (`toSearchResult`) includes `promptMedium` + `media` when present — the staged-pool reader the prep→post split depends on.
- [x] 3.3 `get_question_history` includes `promptMedium` + `media` when present, for consistency.

## 4. Prompt: Claude builds the image block

- [x] 4.1 In the BUILD THE QUESTION CARD BLOCKS step, instruct: for `promptMedium: "image"`, add a SEPARATE `image` block (`{ type: "image", image_url: <media.url>, alt_text: <media.altText> }`) right after the card.
- [x] 4.2 Reword the VISUAL_RESEARCH_SUBFLOW + the three visual SAVE steps to state present facts (no "post_questions injects/renders", no forward-reference to the post step that would leak into PREP). The `media` values become the `media` object passed to `save_question`.
- [x] 4.3 Reword `save_question` tool description / `media` field describe to drop the post_questions-rendering claim.

## 5. Tests

- [x] 5.1 Rewrite the `post_questions` image block: medium-agnostic passthrough — a Claude-built image block posts unchanged exactly once; an image-medium question whose blocks omit the image block gets no injected one.
- [x] 5.2 Add `find_previous_questions` cases: image-medium row surfaces `promptMedium` + `media`; text-medium row omits both.
- [x] 5.3 Add `mediaToJson` unit tests (required fields; optional license/attribution present; omitted when absent).
- [x] 5.4 Update the visual prompt test to assert the build instruction (add a SEPARATE `image` block, `image_url: "<media.url>"`); drop `slackFileId`/`slackFileUrl` from `processRevealAnswers.test`; remove upload deps from `choiceFlow`/`format` integration tests.

## 6. Validation

- [x] 6.1 `npx tsc --noEmit` clean.
- [x] 6.2 `npx vitest run src/plugins/trivia` green; `npx oxlint` + `oxfmt --check` clean on changed files.
- [x] 6.3 `openspec validate fix-trivia-visual-image-posting --strict`.
- [x] 6.4 MANUAL: enabled `promptMedium.image` on the `clack-test` game, fired the question cron — image questions post ONE card with the image below it, no stray/duplicate images. Smoke test passed.
