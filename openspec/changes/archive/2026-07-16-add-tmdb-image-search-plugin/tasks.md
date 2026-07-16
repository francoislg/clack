## 1. Plugin scaffold

- [x] 1.1 Create `src/plugins/tmdb-image-search/` with `index.ts` (entry + three tool registrations), `findMovie.ts`, `findTv.ts`, `findPerson.ts`, `tmdb.ts` (HTTP adapter), and matching `.test.ts` files. Follow the `src/plugins/commons-image-search/` + `src/plugins/brave-image-search/` layout (data-mode return + `process.env` key pattern).
- [x] 1.2 Register the plugin in `src/plugins/registry.ts`: import `tmdbImageSearchPlugin` from `./tmdb-image-search/index.js` and add a `"tmdb-image-search": tmdbImageSearchPlugin` entry to `BUILTIN_PLUGINS`, same pattern as Commons/Brave. Confirm the tools resolve to `mcp__tmdb-image-search__find_movie` / `__find_tv` / `__find_person` (SDK keeps the hyphenated server name verbatim). Register on the always-on default server (no `attach_integration`).
- [x] 1.3 Confirm the plugin loads cleanly whether or not `TMDB_READ_TOKEN` is set (no startup errors/warnings).
- [x] 1.4 Extract the duplicated `imageAndTextResult` + `sourceErrorResult` helpers (currently copied verbatim in `commons-image-search/findSubject.ts`, `brave-image-search/findImage.ts`, `coverart-image-search/findAlbum.ts`) into a shared SDK-layer leaf module `src/plugins/imageSearchResult.ts` (pattern: `src/plugins/zodResult.ts`; type the error parameter structurally as `{ kind: string; message: string }` so each plugin keeps its own `SourceError` union). Refactor the three existing plugins to import it, add `imageSearchResult.test.ts`, and have the TMDB tools import the same module (see 6.3).

## 2. Token plumbing (process.env, NOT core config)

- [x] 2.1 Implement `loadTmdbReadToken(env = process.env): string | null` in `tmdb.ts` — reads `process.env.TMDB_READ_TOKEN` (set in `data/auth/.env`), returns `null` when unset/blank. Do NOT add a `config.plugins.*` field and do NOT import `src/config.ts` (plugin hard rules — `giphy`/`tenor`/`brave` all read `process.env.*`).
- [x] 2.2 The `keyMissing` message names `TMDB_READ_TOKEN` / `data/auth/.env` so admins know where to put the token. Token is the TMDB **v4 read access token**. Example wording: "TMDB read token not configured. Set `TMDB_READ_TOKEN` in `data/auth/.env` (v4 read access token from themoviedb.org → Settings → API) and restart."
- [x] 2.3 Tests: token present → returned; absent → `null`; blank/whitespace-only → `null`.

## 3. TMDB search adapter

- [x] 3.1 In `tmdb.ts`, implement `searchMovies(query, token)`: GET `https://api.themoviedb.org/3/search/movie?query=<enc>&language=en-US&include_adult=false`. Headers: `Authorization: Bearer <token>`, `Accept: application/json`, `User-Agent: Clack-Trivia-Image-Search/1.0`. Timeout 5s.
- [x] 3.2 Implement `searchTv(query, token)` and `searchPerson(query, token)` against `/search/tv` and `/search/person`.
- [x] 3.3 Bounded retry-with-backoff: 429 → one ~1s jittered retry → else `rateLimit`; 5xx → one ~500ms jittered retry → else `network`; timeout/connection failure → `network`.
- [x] 3.4 200 with empty/missing `results` → handled by the caller's selection logic (zero results → `notFound`); 200 with malformed JSON → `unknown`.
- [x] 3.5 Tests per endpoint: happy path; 429→retry→200; 429→retry→429→`rateLimit`; 5xx→retry→`network`; timeout→`network`; malformed JSON→`unknown`. Verify `Authorization: Bearer` on every request.

## 4. TMDB /images adapter (textless backdrops)

- [x] 4.1 In `tmdb.ts`, implement `fetchTextlessBackdrops(kind: "movie" | "tv", id: number, token): { ok: true; backdrops: Backdrop[] } | SourceError` — GET `/{movie|tv}/{id}/images?include_image_language=null`, read the `backdrops[]` array (`file_path`, `vote_average`). Same retry/error policy as §3.
- [x] 4.2 In `tmdb.ts`, implement `pickBestBackdrop(backdrops, searchBackdropPath): string | null` — return the `file_path` with the highest `vote_average` (ties → array order); if `backdrops` is empty, return `searchBackdropPath` when non-null; else `null`.
- [x] 4.3 Tests: highest-vote selection; tie → first; empty backdrops + non-null `backdrop_path` → fallback; empty + null → `null`; `/images` 5xx → `network`.

## 5. TMDB image-CDN downloader

- [x] 5.1 In `tmdb.ts`, implement `fetchImageBytes(cdnUrl)`: download from `https://image.tmdb.org/t/p/<size>/<path>`, `Accept: image/*`, timeout 5s. MIME from `Content-Type`, fallback `image/jpeg`. Reject SVG (`unsupportedFormat`). Enforce 5 MB raw-byte cap before base64.
- [x] 5.2 Returns `{ ok: true, data, mimeType }` or structured errors: CDN 4xx/404 → `network`; 5xx (one retry) → `network`; oversized → `tooLarge`; SVG or non-image Content-Type → `unsupportedFormat`.
- [x] 5.3 Tests: happy path → base64 + mimeType; CDN 404 → `network`; oversized → `tooLarge`; HTML Content-Type → `unsupportedFormat`.

## 6. find_movie tool

- [x] 6.1 In `findMovie.ts`, define MCP tool `find_movie` with Zod schema `{ query: z.string() }` and validate in-handler like the sibling plugins: blank (trimmed-empty) query → `sourceErrorResult({ kind: "notFound", message: "query is empty" })`, > 200 chars → `notFound` structured error. Do NOT rely on Zod `.min()`/`.max()` rejection — a schema-level throw bypasses the `SourceError` contract.
- [x] 6.2 Logic:
  1. `loadTmdbReadToken()` → `null` ⇒ `{ kind: "keyMissing", message }`.
  2. `searchMovies(query, token)` → error ⇒ return it; zero results ⇒ `notFound`.
  3. Iterate up to 10 results; for each (budget: first 3 candidates), `fetchTextlessBackdrops("movie", result.id, token)` + `pickBestBackdrop(...)`. First candidate yielding a backdrop wins. None within budget ⇒ `notFound`. **Never** use `poster_path`.
  4. CDN URL: `https://image.tmdb.org/t/p/w780/<file_path>`.
  5. `fetchImageBytes(url)` → error ⇒ return it.
  6. `subjectId = "tmdb:m-" + result.id`; `title = result.title`.
  7. Metadata: `{ source: "tmdb", subjectId, title, imageUrl: url, license: "CC BY-NC 4.0", attribution: "Data and images via TMDB (themoviedb.org)", format: "data" }`.
- [x] 6.3 Compose multimodal result (data-mode image block + text block) via the shared `imageAndTextResult` helper.
- [x] 6.4 Description states "Best for the Movies category. Returns a textless scene still (backdrop) — never a title-bearing poster. Pass the movie title (with year if helpful, e.g. 'Dune 2021') as `query`."
- [x] 6.5 Tests: happy path (`tmdb:m-<id>`, `w780`, all fields); highest-vote backdrop selected; first candidate has no backdrop → second used; no textless backdrop anywhere + non-null poster → `notFound` (poster NEVER returned); zero results → `notFound`; keyMissing without HTTP; search/`images`/CDN errors propagate; attribution+license constants always set.

## 7. find_tv tool

- [x] 7.1 In `findTv.ts`, mirror `find_movie` with: `searchTv`; `fetchTextlessBackdrops("tv", ...)`; `title = result.name`; `subjectId = "tmdb:tv-" + result.id`; same `w780`.
- [x] 7.2 Description states "Best for the TV Series category (incl. animated series). Returns a textless scene still — never a title-bearing poster. Pass the series name as `query`."
- [x] 7.3 Tests: same shape as find_movie; verify `tmdb:tv-` prefix and `result.name` title.

## 8. find_person tool

- [x] 8.1 In `findPerson.ts`, define `find_person` (same Zod schema).
- [x] 8.2 Logic mirrors find_movie EXCEPT: `searchPerson`; NO `/images` hop — use the matched result's `profile_path` directly, skipping results with null `profile_path` (top-10 cap); `title = result.name`; `subjectId = "tmdb:p-" + result.id`; CDN size `h632`.
- [x] 8.3 Description states "Best for the Actors category (also actresses, filmmakers, crew). Returns a profile headshot. Pass the person's full name as `query`."
- [x] 8.4 Tests: happy path (`tmdb:p-<id>`, `h632`); first result null `profile_path` → second used; all top-10 null → `notFound`; keyMissing; error propagation.

## 9. Plugin registration + i18n labels

- [x] 9.1 In `index.ts`, register a dictionary with EN/FR labels per tool (e.g. `label.find_movie` → "Searching TMDB movies — {query}" / "Recherche de films TMDB — {query}") and register the three tools on the default server via `sdk.registerTool("member", tool, sdk.t(label))` — one dictionary label pair (`label.find_movie`, `label.find_tv`, `label.find_person`) and one `sdk.registerTool` call per tool.
- [x] 9.2 Confirm always-on autoload (no `attach_integration`).

## 10. Documentation

- [x] 10.1 Add `src/plugins/tmdb-image-search/README.md`: what it's for (movies/TV/actors, textless/spoiler-safe); how to get a free TMDB account → Settings → API → **v4 read access token** (not the v3 key); `TMDB_READ_TOKEN` in `data/auth/.env`; attribution requirement + how the plugin satisfies it; CC BY-NC posture; rate limits; the **no-poster / textless-backdrop** behavior and why.
- [x] 10.2 Update `docs/image-search-contract.md` "well-covered sources" list to reflect the shipped TMDB plugin (movies/TV via textless backdrops, actors via profiles) instead of the hypothetical example. Mention `tmdb-image-search` in the recommended stack alongside Commons.

## 11. Integration smoke test (tool level verified via the unit suite; no local TMDB token exists, so the live in-Slack pass happens at deployment, like Commons §6 / coverart §8)

Verification method for the deployed pass (manual, live workspace + token required): inspect the saved question record in `data/plugins/trivia/games/*/questions.json` (`media.source: "tmdb"`, namespaced `media.subjectId`) and the posted Slack message blocks/reveal rendering.

- [x] 11.1 Tool-level behavior unit-verified (data-mode multimodal result, textless-backdrop selection, `media.source: "tmdb"` + `subjectId: "tmdb:m-<id>"`). The full scheduled-run loop (Claude calls `find_movie`, inspects, saves `media`, posts via the file-upload hop) is the visual-questions flow already shipped — re-verify in Slack after deploy with `promptMedium: { text: 0, image: 1 }`, category `"Movies"`, once `TMDB_READ_TOKEN` is set.
- [x] 11.2 Category `"TV Series"` → `find_tv`; `"Actors"` → `find_person` — routing is description-driven (descriptions state category fit); re-verify in Slack after deploy.
- [x] 11.3 Reveal attribution line `📷 Image: Data and images via TMDB (themoviedb.org) · CC BY-NC 4.0` — constants unit-verified on every success path; the reveal rendering is the existing visual-questions directive; confirm visually on the first deployed reveal.
- [x] 11.4 keyMissing path unit-verified (token unset → `keyMissing` without HTTP; plugin loads cleanly tokenless); trivia's fall-through on structured errors is the existing visual-questions behavior.
- [x] 11.5 No-textless-backdrop path unit-verified: empty language-null `backdrops[]` + null search `backdrop_path` → `notFound` across the 3-candidate budget; a poster is structurally unreachable (no code path reads `poster_path`).

## 12. Validation and acceptance

- [x] 12.1 `openspec validate add-tmdb-image-search-plugin --strict` → resolve issues.
- [x] 12.2 `npm test` → all new tests pass.
- [x] 12.3 `npx tsc` (type-check) + `npx oxlint src/plugins/tmdb-image-search` → no errors.
- [x] 12.4 `npx oxfmt src/plugins/tmdb-image-search` → format.
