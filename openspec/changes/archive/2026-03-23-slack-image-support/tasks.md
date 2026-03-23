## 1. Image Extraction and Cache

- [x] 1.1 Create `src/slack/imageExtractor.ts` — `SlackImageFile` type and `extractImageFiles()` function (MIME filtering, size limit, cap, field validation)
- [x] 1.2 Create `src/slack/imageCache.ts` — disk cache in `data/cache/images/` with `getCachedImage()`, `cacheImage()`, `readCachedImageBase64()`
- [x] 1.3 Create `src/slack/imageExtractor.test.ts` — unit tests for extraction (MIME filtering, size limits, cap, malformed input)
- [x] 1.4 Create `src/slack/imageCache.test.ts` — unit tests for cache (miss/hit, storage, base64 reading)

## 2. MCP Tool

- [x] 2.1 Create `src/tools/query/viewSlackImage.ts` — `view_slack_image` MCP tool (cache-aware download, returns MCP ImageContent)
- [x] 2.2 Create `src/tools/query/viewSlackImage.test.ts` — unit tests (cache hit, cache miss with mocked fetch, unknown file ID, download failure)

## 3. Type and Context Wiring

- [x] 3.1 Add `availableImages?: Map<string, SlackImageFile>` to `QueryToolContext` in `src/tools/types.ts`
- [x] 3.2 Add `availableImages` to `BuildQueryContextParams` in `src/tools/context.ts`
- [x] 3.3 Register `view_slack_image` tool in `src/tools/server.ts` when `ctx.availableImages?.size > 0`
- [x] 3.4 Add `imageFiles?: SlackImageFile[]` to `ThreadMessage` and `SessionContext` in `src/sessions.ts`

## 4. Message Pipeline

- [x] 4.1 Update `fetchThreadContext()` in `src/slack/messagesApi.ts` to extract image files from thread messages
- [x] 4.2 Add `imageFiles?: SlackImageFile[]` to `ProcessMessageParams` in `src/slack/handlers/core.ts`
- [x] 4.3 Collect available images from triggering message + thread context into `availableImages` Map in `core.ts`
- [x] 4.4 Thread `availableImages` through `executeAndDeliver()` — flows via `claudeOptions` (no handlerResponse.ts changes needed)

## 5. Claude Integration

- [x] 5.1 Add `availableImages` to `AskClaudeOptions` in `src/claude/index.ts` and pass through to `buildQueryContext()` and `buildPrompt()`
- [x] 5.2 Add image metadata section to `buildPrompt()` in `src/claude/promptBuilder.ts`
- [x] 5.3 Update `src/claude/promptBuilder.test.ts` — verify image metadata section presence and absence

## 6. Trigger Handlers

- [x] 6.1 Extract image files from mention event in `src/slack/handlers/mention.ts`
- [x] 6.2 Extract image files from assistant DM event in `src/slack/handlers/assistant.ts`
- [x] 6.3 Extract image files from resolved message in `src/slack/handlers/newQuery.ts` (reactions)

## 7. Tool Labels and Manifest

- [x] 7.1 Add `view_slack_image` label in `data/default_configuration/tool_mapping/clack.json`
- [x] 7.2 Update `src/streaming/toolLabels.test.ts` with test for new tool label
- [x] 7.3 Add `files:read` to `CORE_SCOPES` in `scripts/generate-manifest.ts`
- [x] 7.4 Regenerate manifest with `npm run manifest`

## 8. Verification

- [x] 8.1 Run `npx tsc` — type check passes
- [x] 8.2 Run `npm test` — all tests pass (1751/1751)
