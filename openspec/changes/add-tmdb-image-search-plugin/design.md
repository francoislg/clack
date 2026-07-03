## Context

`add-trivia-visual-questions` defines the external MCP tool contract; `add-commons-image-search-plugin` Decision 1 resolved that MCP `CallToolResult` only supports data-mode image blocks (`{ type: "image", data, mimeType }`), so every image-search plugin downloads bytes and base64-encodes. `fix-visual-trivia-tool-discovery` resolved that trivia discovers image sources by tool **description**, not by a name substring. This plugin follows both.

TMDB (The Movie Database) is the canonical free API for movie / TV / actor metadata and imagery. Free key at https://www.themoviedb.org/settings/api. Relevant endpoints:

- `/search/movie?query=<q>` / `/search/tv?query=<q>` / `/search/person?query=<q>` — relevance-ranked results. Movies use `title`; TV uses `name`; both carry `id`, `poster_path`, `backdrop_path`. People carry `id`, `name`, `profile_path`.
- `/movie/{id}/images` and `/tv/{id}/images` — return `backdrops[]` (and `posters[]`, `logos[]`). Each backdrop has `file_path`, `vote_average`, `width`, `height`, and an `iso_639_1` language tag. **`?include_image_language=null` filters to backdrops with no language tag — i.e. textless scene stills.**

Image paths are relative; combine with the CDN base + a size: `https://image.tmdb.org/t/p/<size>/<path>`.

**The spoiler constraint is the spine of this design.** Trivia's movie/TV questions are "guess the title/series." A poster prints the title; a language-tagged backdrop often overlays a logo/title. Only a **textless backdrop** is spoiler-safe. So movies/TV resolve their image through `/images?include_image_language=null`, never through `poster_path`, and never fall back to a poster. People are exempt — a headshot reveals nothing — so `find_person` uses `profile_path` directly.

TMDB's terms require attribution: "This product uses the TMDB API but is not endorsed or certified by TMDB." The reveal's `📷 Image: Data and images via TMDB (themoviedb.org)` context block satisfies this; the plugin emits the attribution string verbatim on every success.

Stakeholders: trivia's visual-research prompt (consumer), admins enabling visual rounds (sign up, add token to `data/auth/.env`), Claude during scheduled runs (calls the category-appropriate tool).

## Goals / Non-Goals

**Goals:**

- Implement the visual-questions contract in data mode for three TMDB endpoints (movie, TV, person), one MCP tool each, with descriptions that route by category.
- **Return spoiler-safe imagery**: textless backdrops for movies/TV, profile headshots for people.
- Surface `keyMissing` cleanly when the token is unset (opt-in plugin pattern, matching Brave).
- Source-namespace `subjectId` by content kind (`tmdb:m-`, `tmdb:tv-`, `tmdb:p-`).
- Emit TMDB's attribution + license constants on every success.
- Fixed CDN sizes (`w780` backdrops, `h632` profiles) balancing render quality vs. the 5 MB base64 cap.
- Read the token from `process.env.TMDB_READ_TOKEN` (`data/auth/.env`) — never `config.plugins.*` (plugin hard rule).
- Bounded retry-with-backoff on 429/5xx; structured errors on every failure mode.
- Stateless — no caching.

**Non-Goals:**

- **Posters.** Posters carry the title and spoil "guess" questions. Not returned by any tool, not used as a fallback. (A future "which poster is this?" format could add an opt-in poster tool — out of scope.)
- **Episode-level stills.** v1 uses series-level backdrops for TV. Per-episode stills (`/tv/{id}/season/{s}/episode/{e}/images`) are a follow-up if episode-specific trivia surfaces.
- **Fictional characters.** TMDB indexes works and real people, not fictional characters (no "Pikachu", no "Bart Simpson"). Those route to `add-serper-image-search-plugin`.
- **IMDB-ID lookup, collections, localization (non-`en-US`), config knobs.** v1 is opinionated and English-only.
- **Image quality validation.** Trust TMDB curation + Claude's image-inspection gate (defined in visual-questions).

## Decisions

### Decision 1: Data-mode return per the MCP CallToolResult constraint

Tools return `{ type: "image", data: "<base64>", mimeType }` by downloading the chosen TMDB CDN image and base64-encoding it; the text block carries `format: "data"` and the resolved `imageUrl` (re-fetched by `post_questions` at post time). Same constraint as Commons (Decision 1 there): URL-mode image blocks aren't expressible in an MCP tool result.

### Decision 2: Three MCP tools, one per TMDB content kind

`find_movie`, `find_tv`, `find_person` — separate tools, not one omnibus `find_subject(query, kind)`:

1. **Cleaner routing.** Claude reads descriptions and routes by category structurally; no `kind` arg to get wrong.
2. **Endpoint-specific code.** `title` vs `name`, the backdrop `/images` hop (movie/TV) vs the direct `profile_path` (person) — per-tool paths are simpler than a generic switcher.

Discovery is by description (Decision in `fix-visual-trivia-tool-discovery`); tool names are not matched, so the hyphenated `mcp__tmdb-image-search__*` names are fine.

### Decision 3: Textless backdrops for movies/TV via `/images?include_image_language=null` — no poster fallback

`find_movie` / `find_tv`:

1. Search → resolve the top result's `id` (skipping results that have neither `backdrop_path` nor a usable images set; see Decision 6).
2. GET `/{movie|tv}/{id}/images?include_image_language=null`.
3. From `backdrops[]`, pick the entry with the highest `vote_average` (ties → first). That `file_path` is the image.
4. If `backdrops[]` is empty but the search result's `backdrop_path` is non-null, use it (it is language-agnostic in the search payload — acceptable secondary candidate).
5. If neither yields a backdrop → `{ kind: "notFound" }`. **Never** fall back to `poster_path`.

**Why no poster fallback?** A poster prints the title — returning one to a "guess the movie" question hands Claude (and then the player) the answer. `notFound` lets trivia re-roll to a different subject or medium. This is the single most important behavioral difference from the original (poster-first) proposal.

**Why highest `vote_average`?** TMDB's community votes surface the most representative/recognizable still — best for recognition trivia. Picking `backdrops[0]` (API order) is acceptable but vote-ranked is better.

### Decision 4: Profiles for people via `profile_path` directly

`find_person` uses the matched result's `profile_path` — no `/images` hop. A headshot has no spoiler problem, and the search result's profile is already the canonical one. Skip results with null `profile_path`.

### Decision 5: subjectId kinds — `tmdb:m-`, `tmdb:tv-`, `tmdb:p-`

`tmdb:m-<id>` (movies), `tmdb:tv-<id>` (TV), `tmdb:p-<id>` (people). TMDB numeric IDs are stable and not reused. The kind prefix prevents a movie and a TV show that share a numeric ID from colliding in `find_previous_subjects`.

### Decision 6: Result selection — first usable result, top-10 cap

Iterate `results[]` in rank order, capped at index 10:

- `find_movie` / `find_tv`: skip results with a null `backdrop_path` AND that yield no `/images` backdrops. (In practice: take the first result, attempt the `/images` resolution per Decision 3; if it `notFound`s, advance to the next result.) To bound HTTP cost, the plugin attempts the `/images` hop on at most the first 3 candidate results before returning `notFound`.
- `find_person`: skip results with null `profile_path`; first with a profile wins.

When the top-10 (or the 3-candidate `/images` budget) is exhausted with no usable image → `{ kind: "notFound" }`.

### Decision 7: Fixed image sizes — `w780` backdrops, `h632` profiles

- **Backdrops (movies/TV)**: `w780` — 780px-wide landscape. JPEG, ~100–250 KB typical. Renders well in Slack.
- **Profiles (people)**: `h632` — 632px-tall portrait. JPEG, ~80–150 KB typical.

Not `original` (multi-MB; base64 ×1.33 risks the 5 MB cap). Not a tool arg. Sizes have been stable for years — hardcode rather than query `/configuration`.

### Decision 8: Token from `process.env.TMDB_READ_TOKEN` (`data/auth/.env`), Bearer auth

The plugin reads `process.env.TMDB_READ_TOKEN` via `loadTmdbReadToken(env = process.env): string | null` (returns `null` when unset/blank). It is the TMDB **v4 read access token**, sent as `Authorization: Bearer <token>` on every search, `/images`, and CDN request.

**Why env and not `config.plugins.tmdbImageSearch.apiKey`?** Plugin hard rules (`src/plugins/CLAUDE.md`) forbid plugin code from importing `src/config.ts`. `giphy`, `tenor`, and `brave` all read `process.env.*` from `data/auth/.env`. This corrects the original proposal, which routed the key through core config. The `keyMissing` message names `TMDB_READ_TOKEN` / `data/auth/.env` so admins know where to put it.

**Why Bearer (v4 token) not `?api_key=` (v3)?** Keeps the key out of request URLs/logs; the v4 read token has full read access to these endpoints.

### Decision 9: Attribution + license constants

`attribution: "Data and images via TMDB (themoviedb.org)"` and `license: "CC BY-NC 4.0"` are literal constants on every success — TMDB exposes no per-result licensing. Reveal renders `📷 Image: Data and images via TMDB (themoviedb.org) · CC BY-NC 4.0`.

### Decision 10: Stateless, no caching, no config knobs

Pure HTTP forwarder. No cache (trivia cadence is too low to matter; TMDB's CDN caches upstream). `include_adult=false` always. No size/language overrides in v1.

## Risks / Trade-offs

- **[Risk] Token signup friction.** TMDB requires account + email confirm + token generation (vs. keyless Commons). → README documents it; free tier is generous; a single admin token suffices.
- **[Risk] Extra `/images` hop per movie/TV lookup.** Two API calls + one CDN download. → Acceptable: TMDB is fast, the call is bounded (≤3 candidate results), the plugin stays stateless.
- **[Risk] No textless backdrop for niche titles.** Some obscure/foreign titles have only language-tagged backdrops or none. → `notFound` (no poster spoiler) lets trivia re-roll. Accepted: better to skip than to spoil.
- **[Risk] Wrong result for ambiguous queries** ("Mercury"). → Per-tool routing + the image-inspection gate catch most; a wrong-but-textless still is at worst a re-roll, not a spoiler.
- **[Risk] CC BY-NC (non-commercial).** TMDB restricts commercial use. → Internal-workspace posture satisfies it; documented; admin's deliberate call (same conversation as the dead Brave plugin).
- **[Trade-off] No posters.** Some formats ("which poster?") want them. → Accepted: posters spoil "guess" questions, which is the v1 use case. Opt-in poster tool is a clean future add.

## Migration Plan

No data migration — purely additive (new directory, three tools). Admin enablement:

1. Sign up at https://www.themoviedb.org/signup, confirm email.
2. Settings → API → request access (instant).
3. Copy the **v4 read access token** (NOT the v3 API key).
4. Add `TMDB_READ_TOKEN=<token>` to `data/auth/.env`.
5. Restart. The three tools register; Claude can call them on the next scheduled trivia run.

**Rollback**: remove the token → tools return `keyMissing` → trivia falls through.

## Open Questions

- **Episode-level stills for TV?** Series backdrops are simpler and recognizable. Per-episode stills are a follow-up if episode trivia is requested.
- **Opt-in poster tool for "which poster?" formats?** Out of v1 scope; clean future add (separate tool, no spoiler concern since the format asks about the poster itself).
- **Vote-ranked vs. first backdrop?** v1 picks highest `vote_average`. If that proves to over-select the same few iconic stills, switch to weighted-random among top-N.
