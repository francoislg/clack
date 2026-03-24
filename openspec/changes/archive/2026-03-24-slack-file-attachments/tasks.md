## 1. File Extraction

- [x] 1.1 Create `src/slack/fileExtractor.ts` with `extractFiles()` function — filters for PDFs, text-based MIME types, and unsupported binaries (metadata-only); shares the same size/count limits as image extraction
- [x] 1.2 Create `src/slack/fileExtractor.test.ts` with tests for MIME filtering, size limits, count caps, missing fields, and exclusion of image MIME types

## 2. File Cache

- [x] 2.1 Rename `src/slack/imageCache.ts` → `src/slack/fileCache.ts`, update `CACHE_SUBDIR` to `cache/files`, and generalize naming (interface names, function names)
- [x] 2.2 Update `src/slack/imageCache.test.ts` → `src/slack/fileCache.test.ts` with renamed imports
- [x] 2.3 Update all import sites that reference `imageCache.ts` to use `fileCache.ts`

## 3. View File Tool

- [x] 3.1 Create `src/tools/query/viewSlackFile.ts` with `createViewSlackFileTool()` — routes by MIME type: PDF → `document` block, text → `text` block, unsupported → metadata text
- [x] 3.2 Create `src/tools/query/viewSlackFile.test.ts` with tests for each MIME tier, cache hit/miss, unknown file ID, and invalid UTF-8 handling
- [x] 3.3 Register `view_slack_file` in `src/tools/server.ts` alongside `view_slack_image` (same gating condition: available files or Slack client present)

## 4. Context and Type Updates

- [x] 4.1 Create `SlackFile` interface in `src/slack/fileExtractor.ts` and add `availableFiles?: Map<string, SlackFile>` to `QueryToolContext` in `src/tools/types.ts`
- [x] 4.2 Add `files?: SlackFile[]` field to `ThreadMessage` in `src/sessions.ts`
- [x] 4.3 Update `fetchThreadContext()` in `src/slack/messagesApi.ts` to extract non-image files from thread messages using `extractFiles()`
- [x] 4.4 Update `processMessage()` in `src/slack/handlers/core.ts` to build `availableFiles` map from trigger message and thread context (same pattern as `availableImages`)

## 5. Fetch Tool Integration

- [x] 5.1 Update `fetchSlackMessage.ts` to extract and register non-image files in `ctx.availableFiles`, and include file metadata in results
- [x] 5.2 Update `fetchChannelMessages.ts` (`formatMessage()`) to extract and register non-image files in `ctx.availableFiles`, and include file metadata in results

## 6. Prompt Builder

- [x] 6.1 Update `buildPrompt()` in `promptBuilder.ts` to produce a unified "ATTACHED FILES" section listing both images and files, annotating each with the correct tool to use
- [x] 6.2 Update `formatThreadContext()` to annotate thread messages with file attachments (same pattern as images)
- [x] 6.3 Update prompt builder tests for the unified section and file annotations

## 7. Tool Labels and Streaming

- [x] 7.1 Add `view_slack_file` entry to `data/default_configuration/tool_mapping/clack.json` with label template (e.g., "Viewing file {file_id}")
- [x] 7.2 Add tool label tests for `view_slack_file`

## 8. Mention Handler

- [x] 8.1 Update mention handler (and other trigger handlers as needed) to call `extractFiles()` on the trigger message's files and pass the result through to `processMessage()`
