# tmdb-image-search

Movie / TV / actor image source for visual trivia, backed by **TMDB** (The Movie Database).
Exposes three MCP tools on the plugin's always-on default server, discovered by trivia by
DESCRIPTION (not name):

- `find_movie(query)` (`mcp__tmdb-image-search__find_movie`) — Movies category. Returns a
  **textless backdrop** (scene still).
- `find_tv(query)` (`mcp__tmdb-image-search__find_tv`) — TV Series category, incl. animated
  series (anime/cartoons are TV on TMDB). Returns a **textless backdrop**.
- `find_person(query)` (`mcp__tmdb-image-search__find_person`) — Actors category (also
  actresses, filmmakers, crew). Returns a **profile headshot**.

## Setup (free API token)

1. Sign up at https://www.themoviedb.org/signup and confirm your email.
2. Settings → API → request access (instant approval for personal use).
3. Copy the **API Read Access Token** (the long v4 JWT — NOT the short v3 "API Key").
4. Add `TMDB_READ_TOKEN=<token>` to `data/auth/.env`.
5. Add `"tmdb-image-search"` to the `plugins` array in `data/config.json` and restart.

Without the token the plugin still loads; every tool call returns a structured `keyMissing`
error and trivia's visual subflow silently falls through to another source or to text.

The token is sent as `Authorization: Bearer <token>` on every request (search, `/images`, and
CDN download) — it never appears in URLs or logs.

## No posters — textless backdrops only

Trivia's movie/TV questions are "guess the title/series". A **poster prints the title** — it
would hand the player the answer — so the tools never return one, not even as a fallback.
Instead they resolve `/{movie|tv}/{id}/images?include_image_language=null`, which yields only
backdrops with **no language tag**: textless scene stills. Selection is highest community
`vote_average` (ties → array order); when `/images` is empty, the search result's own
language-agnostic `backdrop_path` is an acceptable secondary candidate. No textless backdrop
within the candidate budget (top 3 results) → a structured `notFound` and trivia re-rolls —
better to skip than to spoil. People are exempt (a headshot reveals nothing), so `find_person`
uses the search result's `profile_path` directly.

Image sizes are fixed: `w780` for backdrops, `h632` for profiles — good Slack rendering while
staying far under the 5 MB image cap.

## Attribution & licensing posture

TMDB's terms require attribution ("This product uses the TMDB API but is not endorsed or
certified by TMDB") and restrict usage to **non-commercial** (CC BY-NC 4.0 posture). Every
successful result carries the literal constants `attribution: "Data and images via TMDB
(themoviedb.org)"` and `license: "CC BY-NC 4.0"`; the trivia reveal renders
`📷 Image: Data and images via TMDB (themoviedb.org) · CC BY-NC 4.0`, satisfying the
attribution requirement. Enabling this plugin in a commercial deployment is a deliberate admin
call — internal-workspace trivia satisfies the non-commercial posture.

## Rate limits & errors

TMDB's free tier allows roughly 50 req/sec — far above trivia cadence (each lookup is at most
search + ≤3 `/images` probes + one CDN download). 429/5xx responses get one bounded jittered
retry, then surface as structured `rateLimit`/`network` errors. All failure modes are structured
(`keyMissing` / `notFound` / `rateLimit` / `network` / `tooLarge` / `unsupportedFormat` /
`unknown`); the tools never throw. Stateless — no caching, no config knobs.
