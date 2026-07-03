## Why

`add-trivia-visual-questions` defines the external MCP tool contract for image search; `add-commons-image-search-plugin` covers Wikipedia/Commons canonical, public-domain subjects (flags, historical figures, landmarks, paintings). The dead `add-brave-image-search-plugin` was meant to cover the generic-web long tail, but Brave killed its free tier and the surviving web-image-search APIs are all usage-billed (out of scope under a free-keys-only policy) — so the copyrighted generic long tail (animated/fictional characters, arbitrary pop culture) stays uncovered. What sits between Commons and that uncovered long tail — the highest-value reachable ground — is **movies, TV series, and actors**, served by TMDB's free, rate-limited (non-usage-billed) key.

The driving use cases are recognition questions: **"What movie is this?"**, **"From what TV series?"**, **"Who is this actor?"**. The critical constraint: those questions need **textless imagery**. A movie/TV **poster has the title printed on it** — it spoils the answer and is useless for a "guess it" question. The right image is a **backdrop / scene still** (a textless frame) for movies/TV, and a **profile headshot** for people.

The Movie Database (TMDB) is the industry-standard free API for this space: free key, generous limits (~50 req/sec on the free tier), well-documented endpoints for movies / TV / people, and — crucially — a dedicated `/images` endpoint that exposes **language-tagged backdrops**, so the plugin can request the textless (`include_image_language=null`) variants. Wikipedia/Commons coverage for contemporary film/TV is poor (copyright walls), and even where it exists the main image is rarely a clean scene still.

This plugin unlocks visual trivia for the `Movies`, `TV Series`, and `Actors` categories with textless, spoiler-safe imagery.

## What Changes

- **New Clack plugin** at `src/plugins/tmdb-image-search/`, registered in the plugin loader. It exposes **three MCP tools** (one per TMDB subject kind):
  - `find_movie(query)` — searches movies, returns a **textless backdrop** (scene still).
  - `find_tv(query)` — searches TV series, returns a **textless backdrop** (scene still). Covers animated series too (anime/cartoons are TV on TMDB).
  - `find_person(query)` — searches people, returns a **profile headshot**.

  The tools resolve to `mcp__tmdb-image-search__find_movie` / `__find_tv` / `__find_person` (the SDK keeps the hyphenated server name verbatim). **Trivia discovers them by tool DESCRIPTION, not by name** (per `fix-visual-trivia-tool-discovery`) — each description states its category fit so Claude routes by the rolled category.

- **Textless-backdrop selection (movies/TV).** After the search resolves a subject ID, the plugin calls `/{movie|tv}/{id}/images?include_image_language=null` and picks the highest-`vote_average` backdrop from the `backdrops[]` array. `include_image_language=null` returns only backdrops with **no language tag** — i.e. textless scene stills. The plugin SHALL NOT fall back to a poster when no textless backdrop exists: a poster carries the title and would spoil a "guess" question. When the `/images` call yields no usable backdrop, the tool returns `{ kind: "notFound" }` so trivia re-rolls. (The search result's own `backdrop_path` is used only as a secondary candidate when the `/images` array is empty but `backdrop_path` is non-null and language-null.)

- **Profile selection (people).** `find_person` returns the matched person's `profile_path` headshot directly from the search result (no `/images` hop — a headshot has no spoiler problem).

- **Tools return multimodal results in data mode** (per `add-commons-image-search-plugin` Decision 1: MCP `CallToolResult` only supports data-mode image blocks). Each tool downloads the chosen image from TMDB's image CDN (`https://image.tmdb.org/t/p/<size>/<path>`), base64-encodes it, and returns `{ type: "image", data, mimeType }` plus a text block with `{ source: "tmdb", subjectId, title, imageUrl, license, attribution, format: "data" }`.

- **`subjectId` namespacing**: `tmdb:m-<id>` (movies), `tmdb:tv-<id>` (TV), `tmdb:p-<id>` (people). Kind-prefixed so a movie and a TV show with the same numeric ID never collide in `find_previous_subjects`.

- **Image sizes**: `w780` for backdrops (landscape scene stills), `h632` for profiles (portrait headshots). Fixed; not `original` (oversized — risks the 5 MB base64 cap). Not exposed as a tool arg.

- **License `"CC BY-NC 4.0"`, attribution `"Data and images via TMDB (themoviedb.org)"`** — literal constants on every successful response (TMDB returns no per-result licensing). The reveal renders `📷 Image: Data and images via TMDB (themoviedb.org) · CC BY-NC 4.0`. The non-commercial posture suits internal trivia; admins enabling this plugin make the call deliberately.

- **Free API key required, read from `process.env.TMDB_READ_TOKEN`** (set in `data/auth/.env`, the bot's plugin-secret convention — `giphy`/`tenor`/`brave` all read `process.env.*`). **NOT** `config.plugins.*`: plugin hard rules (`src/plugins/CLAUDE.md`) forbid plugin code from importing `src/config.ts`. The token is the TMDB **v4 read access token** (sent as `Authorization: Bearer <token>`). When unset, every tool returns `{ kind: "keyMissing" }` and trivia's visual subflow silently moves on.

- **Bounded retry-with-backoff** on 429/5xx; **structured errors** (`keyMissing`, `notFound`, `rateLimit`, `network`, `tooLarge`, `unknown`) per the contract.

- **No persistent storage.** Stateless — each call is up to three HTTP round-trips (search → `/images` → CDN download) for movies/TV, two for people.

## Capabilities

### New Capabilities

- `tmdb-image-search`: the three TMDB MCP tools, their contract conformance (multimodal data-mode return, structured errors, `subjectId` namespacing), textless-backdrop selection for movies/TV, profile selection for people, TMDB image-size selection, mandatory attribution/license constants.

### Modified Capabilities

(none)

## Impact

- **Code**: new `src/plugins/tmdb-image-search/` — `index.ts` (entry + three tool registrations), `findMovie.ts` / `findTv.ts` / `findPerson.ts`, `tmdb.ts` (HTTP adapter: search, `/images`, CDN fetch), plus `.test.ts` files. Loader registration mirrors Commons/Brave.
- **External dependencies**: TMDB API (`https://api.themoviedb.org/3/...`) for search + `/images`; TMDB image CDN (`https://image.tmdb.org/t/p/<size>/<path>`) for downloads. Both HTTPS. Admin needs a free themoviedb.org account + v4 read token. No new npm packages — built-in `fetch`.
- **Configuration**: optional `TMDB_READ_TOKEN` in `data/auth/.env`. Unset → plugin loads, tools return `keyMissing`, trivia falls through.
- **Tests**: mock the TMDB HTTP layer. Happy path per tool (find_movie/find_tv return a textless backdrop with `tmdb:m-`/`tmdb:tv-` subjectIds; find_person returns a profile with `tmdb:p-`). Error paths (keyMissing, zero results, no textless backdrop → notFound, no poster fallback, rate-limit retry, 5xx network, oversized image, CDN failure). Attribution/license constants always set.
- **User-visible behavior**: with the plugin installed and token configured, visual trivia can ask "what movie/series is this?" with spoiler-safe scene stills and "who is this actor?" with headshots. Token unset → no-op (`keyMissing`), trivia falls through. Not installed → unchanged.

## Dependencies

Depends on `add-trivia-visual-questions` (the image-search contract) and adopts `add-commons-image-search-plugin` Decision 1 (data-mode return). Complements the keyless sources rather than depending on them: Commons owns public-domain/canonical subjects (flags, places, monuments, historical figures, art), TMDB owns movies/TV/actors (free key, spoiler-safe). Recommended keyless/free-key deployment: Commons + TMDB + a keyless music source (see the music-source change). The copyrighted generic long tail (animated characters, arbitrary pop culture) has no free/keyless source and is intentionally out of scope.
