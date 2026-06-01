## 1. Plugin scaffold

- [x] 1.1 Create the plugin directory `src/plugins/commons-image-search/` with `index.ts` (plugin entry + tool registration), `findSubject.ts` (tool implementation), `wikimedia.ts` (HTTP adapter), and matching `.test.ts` files
- [x] 1.2 Register the plugin in the project's plugin-loader entry (verify the exact file by checking how `src/plugins/giphy/`, `src/plugins/tenor-gif/`, and `src/plugins/trivia/` are wired up — follow the same registration pattern)
- [x] 1.3 Confirm the plugin loads cleanly at boot with no config, no key, no errors logged

## 2. Wikipedia REST adapter

- [x] 2.1 In `wikimedia.ts`, implement `fetchPageSummary(query: string)`: GET `https://en.wikipedia.org/api/rest_v1/page/summary/<URL-encoded query>`. Set `User-Agent: Clack-Trivia-Image-Search/1.0`. Timeout 5 seconds. Return the parsed JSON or a structured error.
- [x] 2.2 Implement bounded retry-with-backoff: on 429 or 503, retry up to 2 times with jittered exponential backoff (base 500ms). After retry budget exhausted, return `{ kind: "rateLimit", message }`. On 5xx other than 503, retry once then `{ kind: "network", message }`.
- [x] 2.3 Treat 404 as `{ kind: "notFound", message }`. Treat connection failures / timeouts as `{ kind: "network", message }`. Treat 200 with missing-expected-fields as `{ kind: "unknown", message }`.
- [x] 2.4 Tests: happy path; 429 → retry → 200; 429 → retry → 429 → `rateLimit`; 503 → retry → `rateLimit`; 500 → retry once → `network`; 404 → `notFound`; timeout → `network`; malformed JSON → `unknown`.

## 3. Commons imageinfo adapter (license + attribution)

- [x] 3.1 In `wikimedia.ts`, implement `fetchImageInfo(filename: string)`: GET `https://commons.wikimedia.org/w/api.php?action=query&titles=File:<URL-encoded filename>&prop=imageinfo&iiprop=url|extmetadata&format=json`. Same User-Agent, same retry-with-backoff, same timeout.
- [x] 3.2 Extract `license`: prefer `extmetadata.LicenseShortName.value`, fall back to `extmetadata.UsageTerms.value`. Default to the literal string `"unknown"` when both absent.
- [x] 3.3 Extract `attribution`: prefer `extmetadata.Artist.value`, fall back to `extmetadata.Credit.value`. Strip HTML tags from the extracted value (simple regex `<[^>]+>` → `""`). Default to `"via Wikimedia Commons"` when both absent.
- [x] 3.4 Tests: full extmetadata → license + attribution populated correctly; HTML tags stripped from attribution; missing LicenseShortName falls back to UsageTerms; missing both → `"unknown"`; missing Artist falls back to Credit; missing both → `"via Wikimedia Commons"`.

## 4. findSubject tool implementation

- [x] 4.1 In `findSubject.ts`, define the MCP tool `find_subject` with Zod schema `{ query: z.string().min(1).max(200) }`. Reject empty / oversized queries inline with a `notFound` structured error.
- [x] 4.2 Tool logic:
  1. Call `fetchPageSummary(args.query)`; if error → return that error.
  2. Read `summary.thumbnail.source` — if absent, return `{ kind: "unknown", message: "no thumbnail available" }`.
  3. Extract the SOURCE filename from `summary.thumbnail.source` for the imageinfo lookup. NOTE: for a `/thumb/.../<SourceFile>/<size>px-<SourceFile>.<ext>` URL the path tail is the rendered variant, NOT the source file — the source file is the segment BEFORE the size-prefixed tail (implemented as `sourceFilenameFromThumbUrl`, URL-decoded).
  4. Call `fetchImageInfo(filename)`; if error → return `{ kind: "unknown", message: "imageinfo failed: <kind>" }` (license/attribution-fetch failure is NOT a hard fail for the subject lookup, but the per-decision call is best-effort. Decide: either return the subject with defaulted license/attribution, OR treat as unknown. **Pick "default + degrade gracefully" per design.md Decision 4 — return the subject anyway, with `license: "unknown"` and `attribution: "via Wikimedia Commons"`.**)
  5. Determine `subjectId`: if `summary.wikibase_item` exists, return `wikidata:<wikibase_item>`; else return `wikipedia:<URL-encoded page slug>`.
  6. Determine `title`: use `summary.title`.
  7. Determine `imageUrl`: ALWAYS `summary.thumbnail.source` (never `originalimage.source`).
- [x] 4.3 In `wikimedia.ts`, implement `fetchImageBytes(url)`: download the thumbnail, base64-encode it, derive `mimeType` (Content-Type header → URL-extension fallback), enforce a 5 MB cap. Compose the multimodal tool result: data-mode image content block `{ type: "image", data: "<base64>", mimeType }` + text content block with JSON `{ source: "commons", subjectId, title, imageUrl, license, attribution, format: "data" }`. (URL-mode was the original plan but the MCP `CallToolResult` type only supports data-mode image blocks — see design.md Decision 1.)
- [x] 4.4 Edge case: SVG thumbnail. Detect via the URL extension (`.svg`) before download → `{ kind: "unsupportedFormat", message }` (do NOT download or call imageinfo). Also detect `image/svg+xml` Content-Type and oversized payloads at download time → `unsupportedFormat`.
- [x] 4.5 Tests covering each spec scenario:
  - Successful lookup with `wikibase_item` → `subjectId: "wikidata:Q<n>"`
  - Missing `wikibase_item` → `subjectId: "wikipedia:<slug>"`
  - Empty query rejected
  - Oversized query rejected
  - Flag query: `originalimage.source` is SVG but `thumbnail.source` is PNG → returned imageUrl is the PNG
  - Wikipedia 404 → `notFound`
  - Rate-limit retry exhaustion → `rateLimit`
  - Rate-limit then success → returns multimodal result
  - Malformed response → `unknown`
  - Network timeout → `network`
  - License/attribution populated from extmetadata; HTML-stripped from attribution
  - Missing license metadata → defaults to `"unknown"` + `"via Wikimedia Commons"`
  - Thumbnail URL ends in `.svg` → `unsupportedFormat`

## 5. Plugin registration

- [x] 5.1 In `src/plugins/commons-image-search/index.ts`, export the plugin entry: register the `find_subject` tool with the MCP server using the plugin SDK's `registerTool` (or equivalent) so its name resolves to `mcp__commons_image_search__find_subject`. Use the plugin SDK pattern documented in existing plugins (`giphy`, `tenor-gif`).
- [x] 5.2 Add the plugin's MCP-server name to whatever registry the loader scans (verify by reading the existing `data/config.json` patterns and the plugin-loader source). Ensure the plugin is always-on / autoload (no `attach_integration` required — this tool needs to be available to trivia's scheduled-run prompt without an explicit attach step).
- [x] 5.3 Verify the tool description tells Claude what categories it covers well — something like: "Wikipedia/Wikimedia Commons image search. Best for: flags, country symbols, world leaders, historical figures, landmarks, paintings, sculptures, currencies, animals (when species has a Wikipedia article). Returns the article's canonical thumbnail image as a URL. Pass the subject's English Wikipedia title as `query`."

## 6. Integration smoke test

- [ ] 6.1 With both `add-trivia-visual-questions` and this plugin installed, manually trigger a scheduled trivia run with `promptMedium: { text: 0, image: 1 }` and a visual category that maps to Commons (e.g., `"Flags"`, `"Famous People"`, `"Landmarks"`). Verify Claude calls `mcp__commons_image_search__find_subject`, receives the multimodal result, inspects the image, writes a question, saves with `media.source: "commons"`, and posts to Slack with the image rendered via the file-upload hop.
- [ ] 6.2 Verify the reveal renders the attribution context block: `📷 Image: <attribution> · <license>` (or the appropriate fallback form when metadata is sparse).
- [ ] 6.3 Test the no-plugin path: with this plugin temporarily disabled, the same trivia run falls back gracefully to a text-medium question (no errors, no broken cards).

## 7. Documentation

- [x] 7.1 Add a brief plugin README at `src/plugins/commons-image-search/README.md` (or wherever plugin docs live per repo convention) covering: what categories this plugin handles well, what it doesn't (pop-culture, copyrighted subjects), the no-key install path, and the Wikimedia User-Agent etiquette stance.
- [ ] 7.2 Update `CLAUDE.md` (or the appropriate admin-facing doc) to list `commons-image-search` as the recommended first image-search plugin to install for visual trivia.

## 8. Validation and acceptance

- [x] 8.1 Run `openspec validate add-commons-image-search-plugin --strict` and resolve any spec-coherence issues
- [x] 8.2 Run `npm test` — verify all new tests pass
- [x] 8.3 Run `npx tsc` (type-check) and `npx oxlint src/plugins/commons-image-search` (lint) — no errors
- [x] 8.4 Run `npx oxfmt src/plugins/commons-image-search` to format
