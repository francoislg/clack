## 1. Plugin scaffold

- [x] 1.1 Create `src/plugins/coverart-image-search/` with `index.ts` (entry + tool registration + i18n labels), `findAlbum.ts` (tool impl), `musicbrainz.ts` (HTTP adapter: MusicBrainz search + CAA cover fetch + image download), and matching `.test.ts` files. Follow the `src/plugins/commons-image-search/` layout closely — this plugin is keyless with the same Wikimedia-style etiquette.
- [x] 1.2 Register the plugin in the plugin loader, same pattern as Commons. Confirm the tool resolves to `mcp__coverart-image-search__find_album` (SDK keeps the hyphenated server name verbatim). Register on the always-on default server (no `attach_integration`).
- [x] 1.3 Confirm the plugin loads cleanly with no configuration (keyless — no key load, no `keyMissing` path).

## 2. MusicBrainz search adapter

- [x] 2.1 In `musicbrainz.ts`, implement `searchReleaseGroups(query: string)`: GET `https://musicbrainz.org/ws/2/release-group/?query=<enc>&fmt=json&limit=10`. Headers: `User-Agent: Clack-Trivia-Image-Search/1.0 (https://github.com/<repo>)`, `Accept: application/json`. Timeout 5s.
- [x] 2.2 Define a `ReleaseGroup` type reading the fields used: `id` (MBID), `title`, `artist-credit?: [{ name }]`. Return `{ ok: true; releaseGroups: ReleaseGroup[] } | SourceError`.
- [x] 2.3 Bounded retry-with-backoff: 429/503 → up to 2 jittered exponential-backoff retries → else `rateLimit`; other 5xx → one retry → else `network`; timeout/connection failure → `network`. (Reuse the Commons `requestRaw` shape.)
- [x] 2.4 200 with missing/empty `release-groups` → handled by selection (zero → `notFound`); 200 with malformed JSON → `unknown`.
- [x] 2.5 Tests: happy path; 503→retry→200; 429×3→`rateLimit`; 500→retry→`network`; timeout→`network`; empty `release-groups`→ selection returns `notFound`; missing field→`unknown`. Verify the descriptive `User-Agent` on every request.

## 3. Cover Art Archive adapter

- [x] 3.1 In `musicbrainz.ts`, implement `fetchFrontCover(mbid: string)`: GET `https://coverartarchive.org/release-group/<mbid>/front-500` (follow redirects). Same `User-Agent`, timeout 5s. Map CAA 404 → `{ kind: "notFound" }` (release-group has no cover art — caller advances to the next candidate). Same retry policy as §2.3 for 429/503/5xx.
- [x] 3.2 On success (non-404), return the canonical CAA cover URL (`https://coverartarchive.org/release-group/<mbid>/front-500`) — the caller invokes `fetchImageBytes(url)` separately to download the bytes (fetch follows the 307 itself). Matches the Commons pattern: discovery and byte download are separate requests.
- [x] 3.3 Tests: 200 → resolved URL; 404 → `notFound`; 503→retry→200; 5xx→retry→`network`.

## 4. Image-byte downloader

- [x] 4.1 In `musicbrainz.ts`, implement `fetchImageBytes(url)`: download with `User-Agent`, timeout 5s. MIME from `Content-Type` → URL-extension fallback. Reject `image/svg+xml` and non-`image/*`. Enforce 5 MB raw-byte cap. (Reuse the Commons `fetchImageBytes` shape verbatim.)
- [x] 4.2 Returns `{ ok: true, data, mimeType }` or structured errors: transport failure → `network`; SVG/oversized → `unsupportedFormat`; non-image Content-Type → `unknown`.
- [x] 4.3 Tests: happy path → base64 + mimeType; SVG → `unsupportedFormat`; oversized → `unsupportedFormat`; HTML Content-Type → `unknown`.

## 5. find_album tool

- [x] 5.1 In `findAlbum.ts`, define MCP tool `find_album` with Zod schema `{ query: z.string() }` and reject empty/oversized queries INLINE in the handler with a structured error (the Commons pattern — schema-level `.min/.max` would surface as an MCP validation error instead of the contract's structured `SourceError`, and `.min(1)` misses whitespace-only queries).
- [x] 5.2 Logic:
  1. `searchReleaseGroups(query)` → error ⇒ return it; zero release-groups ⇒ `notFound`.
  2. Iterate release-groups (cap 10; CAA-fetch budget 3): for each, `fetchFrontCover(rg.id)`. CAA `notFound` (404) ⇒ advance; other errors ⇒ return. First cover wins. None within budget ⇒ `{ kind: "notFound", message: "no cover art in top candidates" }`.
  3. `fetchImageBytes(coverUrl)` → error ⇒ return it.
  4. `subjectId = "coverart:rg-" + rg.id`.
  5. `title = artistCredit ? `${artistCredit} – ${rg.title}` : rg.title`.
  6. Metadata: `{ source: "coverart", subjectId, title, imageUrl: coverUrl, license: "unknown", attribution: "via Cover Art Archive", format: "data" }`.
  7. Compose the multimodal result (data-mode image block + text block) via a local `imageAndTextResult` helper (each image-search plugin defines its own copy — see commons/brave; plugins must not import across plugin folders).
- [x] 5.3 Description: "Album cover art via MusicBrainz + Cover Art Archive (keyless). Best for 'what album is this cover?'. Returns the canonical front cover inline plus artist/album metadata. Pass `artist album` (e.g. 'Nirvana Nevermind') or an album title as `query`. Check the returned `title` — tribute/cover albums can outrank the original; if it names the wrong artist, retry with a more distinctive query. Note: some covers print the title — prefer iconic textless covers for guessing." (The title-check sentence came out of live verification: MusicBrainz free-text ranking put a tribute album above the original for "Pink Floyd The Dark Side of the Moon".)
- [x] 5.4 Tests covering the tool-level spec scenarios (adapter-level scenarios are tested in 2.5 / 3.3 / 4.3; plugin-load in 1.3): successful lookup (all metadata fields, `coverart:rg-<mbid>`, `"<artist> – <album>"` title); top release-group 404 → 2nd selected; first 3 release-groups 404 → `notFound`; zero results → `notFound`; title fallback when no artist credit; search/CAA/download errors propagate; license+attribution constants; never returns `keyMissing`; no caching (same query twice → the search/fetch deps are invoked twice, fresh round-trips).

## 6. Plugin registration + i18n labels

- [x] 6.1 In `index.ts`, register a dictionary with EN/FR labels (e.g. `label.find_album` → "Searching album covers — {query}" / "Recherche de pochettes d'album — {query}") and register `find_album` on the default server via `sdk.registerTool("member", tool, sdk.t("label.find_album"))`.
- [x] 6.2 Confirm always-on autoload (no `attach_integration`); loads with no configuration.

## 7. Documentation

- [x] 7.1 Add `src/plugins/coverart-image-search/README.md`: what it's for (album covers, keyless); MusicBrainz + CAA, no key/signup; the `license: "unknown"` posture + internal-trivia judgment call; that musician/band photos come from the Commons plugin (this one is cover-art only); MusicBrainz etiquette (User-Agent, 1 req/sec); the album-cover spoiler caveat (handled by the prompt's image-inspection gate, prefer textless iconic covers).
- [x] 7.2 Update `docs/image-search-contract.md` "well-covered sources" list to add CAA (album covers, keyless). Note the recommended stack: Commons (public-domain/canonical + musician photos) + TMDB (movies/TV/actors, free key) + Cover Art Archive (album covers, keyless).

## 8. Integration smoke test (tool level verified locally; the in-Slack pass happens at deployment, like Commons §6)

- [x] 8.1 Tool-level live verification (done pre-deploy): drive `find_album` against real MusicBrainz + CAA and confirm the data-mode multimodal result (base64 image block + `{ source: "coverart", subjectId: "coverart:rg-<mbid>", title, imageUrl, license: "unknown", attribution: "via Cover Art Archive", format: "data" }`). The full scheduled-run loop (Claude calls the tool, saves `media`, posts via the file-upload hop) is the visual-questions flow already shipped — re-verify in Slack after deploy with `promptMedium: { text: 0, image: 1 }` on an album-cover category.
- [x] 8.2 Verify reveal renders `📷 Image: via Cover Art Archive` — the reveal directive omits ` · <license>` for the literal `"unknown"` (added to `scheduledPrompts.ts` with this change); confirm visually on the first deployed reveal.
- [x] 8.3 No-cover path: all-candidates-404 → `notFound` (unit-tested: budget-exhaustion + zero-results scenarios); trivia's re-roll on structured errors is the existing visual-questions behavior.
- [x] 8.4 Spoiler path: confirmed prompt-layer, not a plugin concern — the image-inspection gate lives in trivia's `scheduledPrompts.ts` VISUAL RESEARCH SUBFLOW; no plugin change involved.

## 9. Validation and acceptance

- [x] 9.1 `openspec validate add-coverart-image-search-plugin --strict` → resolve issues.
- [x] 9.2 `npm test` → all new tests pass.
- [x] 9.3 `npx tsc` (type-check) + `npx oxlint src/plugins/coverart-image-search` → no errors.
- [x] 9.4 `npx oxfmt src/plugins/coverart-image-search` → format.
