## Context

Clack already has a complete pipeline for Slack image attachments: extraction (`imageExtractor.ts`), caching (`imageCache.ts`), a viewing tool (`viewSlackImage.ts`), prompt metadata (`promptBuilder.ts`), and thread context propagation (`messagesApi.ts`). The Claude API supports three content block types in tool results: `image` (png/jpeg/gif/webp), `document` (base64 PDF or plain text), and `text`. This means we can extend the existing pipeline to handle PDFs and text-based files natively, without any conversion layer.

The current implementation uses `SlackImageFile` as the shared type and `availableImages` as the context map. These are image-specific names but the underlying structure (id, name, mimetype, size, url_private) is already generic enough for any file type.

## Goals / Non-Goals

**Goals:**
- Support viewing PDF attachments via Claude's native `document` content block
- Support viewing text-based file attachments (code, CSV, JSON, markdown, logs, plain text) as `text` content blocks
- Return metadata-only responses for unsupported binary formats (xlsx, zip, etc.) so Claude can at least tell the user what was attached
- Reuse the existing cache infrastructure with minimal changes
- Surface file metadata in thread context and prompt builder so Claude knows what's available

**Non-Goals:**
- Converting Office documents (docx, xlsx, pptx) to readable formats — out of scope, can be added later
- Supporting file uploads back to Slack — read-only viewing
- Handling files from external sources (Google Drive links, etc.) — only native Slack file uploads
- Changing the existing `view_slack_image` tool — it continues to work for images; the new tool handles everything else

## Decisions

### 1. New `view_slack_file` tool alongside existing `view_slack_image`

**Decision:** Create a separate `view_slack_file` tool rather than extending `view_slack_image`.

**Rationale:** The tools return fundamentally different content block types (`image` vs `document`/`text`). A combined tool would need conditional return types that muddy the tool description. Keeping them separate lets Claude choose the right tool based on the file type. The `view_slack_image` tool's description and behavior remain unchanged — no regression risk.

**Alternative considered:** Merging into a single `view_slack_attachment` tool. Rejected because it would change the existing tool's name and contract (breaking change for prompt instructions and tool label configs).

### 2. Parallel `SlackFile` type and `availableFiles` map alongside existing image infrastructure

**Decision:** Add a new `SlackFile` interface and `availableFiles: Map<string, SlackFile>` to `QueryToolContext`, separate from the existing `availableImages` map.

**Rationale:** The image pipeline is working and stable. Interleaving file types into `availableImages` would require updating every consumer (extractors, fetch tools, prompt builder, the image viewing tool). Keeping them parallel means zero changes to image code paths. The two maps are populated side-by-side in the same extraction pass.

**Alternative considered:** Unifying into a single `availableAttachments` map. While cleaner long-term, it touches every existing consumer and risks regressions for a feature that already works.

### 3. New `fileExtractor.ts` alongside existing `imageExtractor.ts`

**Decision:** Create a new `extractFiles()` function in a new `fileExtractor.ts` that captures PDFs and text-based files, complementing `extractImageFiles()` which continues to handle images.

**Rationale:** Same isolation principle. `extractImageFiles()` is called in 4+ places and tested. A separate function avoids touching working code. Both functions operate on the same `msg.files` array but filter for different MIME types.

### 4. Generalize cache from `imageCache` to `fileCache`

**Decision:** Rename `imageCache.ts` → `fileCache.ts` and generalize the interface. The on-disk structure (`data/cache/files/` instead of `data/cache/images/`) and API stay the same — just broader naming. A migration alias or re-export is not needed since the cache directory is gitignored runtime data.

**Rationale:** The cache code is already MIME-agnostic internally — it stores arbitrary buffers with metadata sidecars. Only the naming is image-specific. Unlike the extractor and tool, there's no benefit to keeping two separate caches for the same download-and-store pattern.

**Alternative considered:** Keeping `imageCache.ts` and adding `fileCache.ts`. Rejected because it's pure duplication — the code is identical.

### 5. MIME type classification for content block routing

**Decision:** Classify files into three tiers in the view tool:

| Tier | MIME types | Content block | Notes |
|------|-----------|---------------|-------|
| PDF | `application/pdf` | `document` (base64) | Native Claude support |
| Text | `text/*`, plus `application/json`, `application/xml`, `application/javascript`, `application/typescript`, `application/x-yaml`, `application/x-sh` | `text` (UTF-8 string) | Read file as text |
| Unsupported | Everything else | `text` (metadata only) | Return filename, size, MIME type — no content |

**Rationale:** This covers the vast majority of files users share in Slack. The text tier casts a wide net (`text/*` catches csv, markdown, plain, html, etc.) and includes common code MIME types that Slack may report under `application/`. Unsupported files get a graceful fallback rather than an error.

### 6. File size limits

**Decision:** Use the same 20MB per-file limit as images. Cap at 10 files per message (shared cap across images + files).

**Rationale:** The 20MB limit matches Slack's own file upload constraints. The Claude API document block has no official size limit but large base64 payloads increase latency and token usage. 20MB is a practical ceiling that handles virtually all user uploads.

### 7. Prompt builder: unified "ATTACHED FILES" section

**Decision:** When both images and files are present, show a single "ATTACHED FILES" section that lists all attachments with their type, rather than separate "ATTACHED IMAGES" and "ATTACHED FILES" sections.

**Rationale:** From Claude's perspective, the distinction is which tool to call (`view_slack_image` vs `view_slack_file`). A unified list with type annotations is clearer than two separate sections. When only images are present (no files), the section title is still "ATTACHED FILES" for consistency.

## Risks / Trade-offs

- **[Text encoding]** Some files labeled `text/*` may not be valid UTF-8. → Mitigation: use `TextDecoder` with `fatal: false` to replace invalid sequences rather than crashing.
- **[Large PDFs]** A 15MB PDF as base64 is ~20MB in the API request, consuming significant context. → Mitigation: accept this for now; can add page-range extraction later if it becomes a problem.
- **[Cache directory change]** Renaming `cache/images/` to `cache/files/` means existing cached images are orphaned. → Mitigation: the cache is transient runtime data (gitignored). Old images will be re-downloaded on first access. No migration needed.
- **[Two viewing tools]** Claude must choose between `view_slack_image` and `view_slack_file`. → Mitigation: the prompt's ATTACHED FILES section annotates each file with its type and which tool to use.
