## 1. Plugin scaffold

- [x] 1.1 Create the plugin directory `src/plugins/brave-image-search/` with `index.ts` (plugin entry + tool registration), `findImage.ts` (tool implementation), `brave.ts` (HTTP adapter), and matching `.test.ts` files. Follow the existing plugin layout pattern from `src/plugins/giphy/`, `src/plugins/tenor-gif/`, and `src/plugins/commons-image-search/` (verify the convention by reading those plugins).
- [x] 1.2 Register the plugin in the project's plugin-loader entry, using the same registration pattern as the Commons image-search plugin.
- [x] 1.3 Confirm the plugin loads cleanly at boot whether or not the Brave API key is configured (no startup errors, no warnings)

## 2. Configuration plumbing

- [x] 2.1 Read the key from `process.env.BRAVE_API_KEY` (set in `data/auth/.env`, the bot's plugin-secret convention — giphy/tenor read `process.env.*`). NOT a `config.plugins.*` field: plugin hard rules (`src/plugins/CLAUDE.md`) forbid plugin code from importing `src/config.ts`. No core-config change.
- [x] 2.2 Implement `loadBraveApiKey(env = process.env): string | null` that returns `null` when unset/blank. The `keyMissing` message names `BRAVE_API_KEY` / `data/auth/.env` so admins know where to put the key.
- [x] 2.3 Tests: key present → returned; key absent → `null`; blank/whitespace-only key → `null`.

## 3. Brave Search adapter

- [x] 3.1 In `brave.ts`, implement `searchImages(query: string, apiKey: string)`: GET `https://api.search.brave.com/res/v1/images/search?q=<URL-encoded query>&safesearch=strict`. Set headers `X-Subscription-Token: <apiKey>`, `Accept: application/json`, `User-Agent: Clack-Trivia-Image-Search/1.0`. Timeout 5 seconds.
- [x] 3.2 Implement bounded retry-with-backoff: on 429, retry once with 1-second jittered backoff; if still 429 → `{ kind: "rateLimit", message }`. On 5xx, retry once with 500ms jittered backoff; if still 5xx → `{ kind: "network", message }`. Timeout / connection failure → `{ kind: "network", message }`.
- [x] 3.3 Treat 200 with no `results` array or empty `results: []` as `{ kind: "notFound" }`. Treat 200 with malformed JSON structure as `{ kind: "unknown" }`.
- [x] 3.4 Tests: happy path; 429 → retry → 200; 429 → retry → 429 → `rateLimit`; 500 → retry → `network`; timeout → `network`; empty results → `notFound`; missing `results` field → `unknown`.

## 4. Result selection and metadata assembly

- [x] 4.1 In `findImage.ts`, define the MCP tool `find_image` with Zod schema `{ query: z.string().min(1).max(200) }`. Reject empty/oversized queries inline with a structured error.
- [x] 4.2 Tool logic:
  1. Resolve the API key via `loadBraveApiKey()`. If `null` → return `{ kind: "keyMissing", message: "Brave Search API key not configured at <path>" }`.
  2. Call `searchImages(args.query, apiKey)`. If error → return that error.
  3. Iterate `results[]` in order, up to index 10. For each, extract the image URL (use `result.properties.url` per Brave's response shape — verify by inspecting actual API output). Test the URL's extension (case-insensitive): accept `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`; skip everything else.
  4. If no renderable image found in the top 10, return `{ kind: "notFound", message: "no renderable image in top 10 results" }`.
  5. For the selected result, compute `subjectId`: SHA-256 the image URL, hex-encode, take the first 12 chars, prefix with `"brave:"`. Use Node's `crypto.subtle.digest('SHA-256', ...)` or `crypto.createHash('sha256')`.
  6. Compute `attribution`: try `new URL(result.source).host` (Brave's `result.source` is the source page URL); on success use `"via <host>"`; on parse failure use `"via Brave Search"`.
  7. Assemble metadata: `{ source: "brave", subjectId, title: result.title, imageUrl, license: "unknown", attribution, format: "data" }`.
- [x] 4.3 Download the selected image (`fetchImageBytes`: base64 + MIME from Content-Type → URL-extension fallback + 5 MB cap + SVG reject) and compose the multimodal tool result: data-mode image content block `{ type: "image", data, mimeType }` + text content block with the metadata JSON. (URL-mode was the original plan but the MCP `CallToolResult` type only supports data-mode image blocks — see design.md Decision 1.)
- [x] 4.4 Tests covering each spec scenario:
  - Successful lookup with valid source page → metadata fields populated as specified
  - SVG top result skipped, JPEG selected
  - All top-10 results unsupported → `notFound`
  - SHA-256 of identical URL is deterministic (same URL → same subjectId)
  - Different URLs produce different subjectIds
  - Source URL `https://en.wikipedia.org/wiki/Foo` → `attribution: "via en.wikipedia.org"`
  - Malformed source URL → `attribution: "via Brave Search"`
  - Empty query rejected
  - Oversized query rejected
  - Key missing → `keyMissing` without HTTP request
  - 429 retry exhaustion → `rateLimit`
  - 429 retry success → multimodal result
  - 5xx retry exhaustion → `network`
  - Timeout → `network`
  - Empty results → `notFound`
  - Malformed `results` field → `unknown`

## 5. Plugin registration

- [x] 5.1 In `src/plugins/brave-image-search/index.ts`, export the plugin entry: register the `find_image` tool with the MCP server using the plugin SDK's registration pattern so the tool's full name resolves to `mcp__brave_image_search__find_image`.
- [x] 5.2 Add the plugin's MCP-server name to whatever registry the loader scans. Configure as always-on / autoload (no `attach_integration` step — trivia's prompt needs the tool available without explicit attach).
- [x] 5.3 Write the tool description so Claude understands when to call it. Recommended: "Generic web image search via Brave Search. Best for: long-tail subjects not covered by specialized image-search plugins — movie scenes, TV stills, video game character art, anime/comic characters, contemporary pop culture, regional figures. Returns the top-ranked renderable image (JPEG/PNG/WebP/GIF) as a URL. License is always 'unknown'; attribution is the source-page domain. Pass a descriptive subject query (e.g., 'Inception staircase scene', 'Pikachu character art')."

## 6. Documentation

- [x] 6.1 Add a plugin README at `src/plugins/brave-image-search/README.md` covering:
  - What this plugin is for (long-tail / generic fallback)
  - How to obtain the free API key (link to https://search.brave.com/api)
  - Where to put the key (`BRAVE_API_KEY` in `data/auth/.env`)
  - The licensing posture (link to design.md Decision 4): images are re-hosted to a private Slack workspace with attribution shown on reveal; admins enabling the plugin make this judgment call deliberately
  - The free-tier quota (~2000/month) and rate-limit behavior
- [ ] 6.2 Update `CLAUDE.md` (or admin-facing doc) to list `brave-image-search` as the recommended second image-search plugin (after Commons) for visual trivia, with the caveats around licensing and quota.

## 7. Integration smoke test

- [ ] 7.1 With `add-trivia-visual-questions`, `add-commons-image-search-plugin`, and this plugin all installed (and Brave key configured), manually trigger a scheduled trivia run with `promptMedium: { text: 0, image: 1 }` for a category Commons doesn't cover well (e.g., `"Movies"` or `"Video Games"`). Verify Claude prefers Brave for that category (reads tool descriptions, picks Brave), receives the multimodal result, inspects the image, writes a question, saves with `media.source: "brave"` and `media.subjectId: "brave:<hash>"`, posts to Slack with the image rendered.
- [ ] 7.2 Verify the reveal renders `📷 Image: via <source-domain>` (no license since Brave returns "unknown").
- [ ] 7.3 Test the keyMissing path: with the Brave API key temporarily removed, the same trivia run either falls through to another image-search tool (if installed) or to text — no errors surface, no broken cards.
- [ ] 7.4 Test the rate-limit path: simulate Brave returning 429 (via test harness, not by burning quota) and verify Claude moves on to another image-search tool or text.

## 8. Validation and acceptance

- [x] 8.1 Run `openspec validate add-brave-image-search-plugin --strict` and resolve any spec-coherence issues
- [x] 8.2 Run `npm test` — verify all new tests pass
- [x] 8.3 Run `npx tsc` (type-check) and `npx oxlint src/plugins/brave-image-search` (lint) — no errors
- [x] 8.4 Run `npx oxfmt src/plugins/brave-image-search` to format
