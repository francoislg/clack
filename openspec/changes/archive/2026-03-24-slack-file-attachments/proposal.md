## Why

Clack can view images attached to Slack messages, but non-image file attachments (PDFs, code files, CSVs, text documents) are silently ignored. Users frequently share files alongside their questions — asking Clack to analyze a PDF report, review a config file, or explain a CSV export. Today, Clack cannot see these files at all.

## What Changes

- Broaden file extraction to capture PDFs and text-based files alongside images
- Add a `view_slack_file` tool that returns the appropriate Claude API content block type based on MIME:
  - PDFs → `document` content block (base64, natively supported by Claude)
  - Text-based files (code, CSV, JSON, markdown, logs, plain text) → `text` content block (read as UTF-8)
  - Unsupported binary formats → metadata-only text response (filename, size, type)
- Generalize the image cache to a file cache that stores any downloaded Slack file
- Update prompt builder to list all attached files (not just images) with guidance for Claude to view them
- Annotate thread context messages with file attachment metadata (same as the image annotation pattern)

## Capabilities

### New Capabilities
- `slack-file-attachments`: Extraction, caching, viewing, and prompt surfacing of non-image file attachments (PDFs, text files) from Slack messages

### Modified Capabilities
- `slack-image-support`: Image extraction broadens to a general file extraction pipeline; image-specific behavior remains but shares infrastructure with file attachments

## Impact

- `src/slack/imageExtractor.ts` → renamed/generalized to handle all file types, or a new parallel extractor added
- `src/slack/imageCache.ts` → generalized to `fileCache.ts` (already mostly MIME-agnostic)
- `src/tools/query/viewSlackImage.ts` → new `viewSlackFile.ts` tool (or extended existing tool)
- `src/claude/promptBuilder.ts` → updated `ATTACHED IMAGES` section to include all file types
- `src/slack/messagesApi.ts` → extract non-image files from thread messages
- `src/tools/server.ts` → register new tool
- `src/tools/types.ts` → context type may need file map alongside image map
- `src/sessions.ts` → `ThreadMessage` type broadened for non-image files
- Tool mapping config for the new tool label
