## Context

`add-trivia-visual-questions` defines the external image-search contract; `add-commons-image-search-plugin` Decision 1 resolved that MCP `CallToolResult` only supports data-mode image blocks (download + base64); `fix-visual-trivia-tool-discovery` resolved discovery-by-description. This plugin follows all three, and is keyless — the same posture as the Commons plugin.

**MusicBrainz** is the open music-metadata database. Relevant endpoint:

- `GET https://musicbrainz.org/ws/2/release-group/?query=<q>&fmt=json&limit=10` → `{ "release-groups": [ { "id": "<mbid>", "title", "artist-credit": [ { "name", "artist": {...} } ], "primary-type", ... } ] }`. The `release-group` (album as a work, across editions) is the right granularity for "what album is this?" — more stable than a specific `release` (pressing).

**Cover Art Archive** serves cover images keyed by MBID:

- `GET https://coverartarchive.org/release-group/<mbid>/front-500` → 307-redirects to the 500px front cover image (or 404 when the release-group has no cover art). The `front-<size>` variants (`front-250`, `front-500`, `front-1200`) avoid the multi-MB original.

Both are keyless but require **etiquette**: a descriptive `User-Agent` (MusicBrainz blocks generic/empty agents) and ≤ 1 req/sec sustained. The Commons plugin already models this (User-Agent + bounded backoff); this plugin reuses the pattern.

The plugin's role: **album cover art**. Musician/band photos are already covered by the Commons plugin for famous acts; this plugin does not attempt artist photos (CAA has none — it is cover art only).

Stakeholders: trivia's visual-research prompt (consumer), admins (just add the plugin — no key), Claude during scheduled runs (calls `find_album` for music-cover categories).

## Goals / Non-Goals

**Goals:**

- Implement the visual-questions contract in data mode over MusicBrainz + CAA: one keyless `find_album(query)` tool.
- Resolve album covers via release-group MBID; fall through MusicBrainz candidates when a release-group has no CAA cover.
- Native, stable `subjectId` (`coverart:rg-<mbid>`).
- `license: "unknown"`, `attribution: "via Cover Art Archive"`, `title: "<artist> – <album>"`.
- MusicBrainz/CAA etiquette: descriptive `User-Agent`, bounded retry-with-backoff on 429/503, 5 MB byte cap.
- Structured errors on every failure; no `keyMissing` (keyless).
- Stateless — no caching.

**Non-Goals:**

- **Artist/band photos.** CAA is cover art only; Commons covers famous artists. Out of scope.
- **`release`-level (specific pressing) covers.** v1 uses `release-group` (the album-as-work). Per-edition covers are unnecessary for "what album is this?".
- **Textless / spoiler filtering.** No textless filter exists for cover art; spoiler avoidance is prompt-layer (see the proposal's note).
- **Disambiguation UI / multi-result return.** Top candidate with a cover wins; the inspection gate is the backstop for wrong picks.
- **Config knobs / API key.** Keyless and opinionated (release-group, `front-500`).

## Decisions

### Decision 1: Data-mode return per the MCP CallToolResult constraint

`find_album` downloads the CAA cover and returns `{ type: "image", data: "<base64>", mimeType }` + a text block (`format: "data"`, with the resolved `imageUrl`). Same constraint as Commons/TMDB.

### Decision 2: release-group granularity + candidate fall-through

Search `release-group` (not `release`): one entry per album-as-work, the natural "what album?" unit, and more likely to have a canonical cover than an obscure pressing. Iterate the top MusicBrainz results (cap 10; CAA-fetch budget 3): for each, attempt `https://coverartarchive.org/release-group/<mbid>/front-500`. The first that returns an image wins. A release-group with no cover art returns CAA 404 → advance. No usable cover within budget → `{ kind: "notFound" }`.

**Why a CAA-fetch budget of 3?** Bounds HTTP cost (each candidate is a CAA round-trip + a redirect). MusicBrainz relevance drops fast; if the top 3 release-groups have no cover, the query is too obscure for cover trivia — re-roll.

### Decision 3: subjectId — `coverart:rg-<mbid>`

The MusicBrainz release-group MBID is a stable, native UUID. `coverart:rg-<mbid>` namespaces it (the `rg-` marks release-group, leaving room for a future `r-` release tier). Far better dedup than a URL hash — `find_previous_subjects` matches re-encounters of the same album reliably.

### Decision 4: license "unknown", attribution "via Cover Art Archive"

CAA hosts copyrighted album artwork (uploaded under promotional/fair-use terms), not CC/PD — so `license` is the literal `"unknown"` (like Brave). `attribution` is the constant `"via Cover Art Archive"`. Reveal renders `📷 Image: via Cover Art Archive`. Internal-trivia posture — admin's documented call.

### Decision 5: title — "<artist credit> – <release-group title>"

Compose `title` from the first artist-credit name + the release-group title (`"Pink Floyd – The Dark Side of the Moon"`). Gives Claude a clear subject label. When the artist credit is missing, fall back to the release-group title alone.

### Decision 6: Keyless + MusicBrainz/CAA etiquette

No key, no config — loads and works on install (like Commons). Every request sets `User-Agent: Clack-Trivia-Image-Search/1.0 (https://github.com/<repo>)` (descriptive per MusicBrainz policy). Bounded retry-with-backoff on 429/503 (jittered, capped). 5 MB byte cap on the cover download; reject SVG / non-image `Content-Type`.

### Decision 7: Stateless, no caching

No cache. Each call: MusicBrainz search → CAA cover fetch(es) → image download. MusicBrainz/CAA CDNs handle upstream caching; trivia cadence is too low to matter.

## Risks / Trade-offs

- **[Risk] MusicBrainz 1 req/sec etiquette.** Trivia cadence is far under this. → Bounded backoff on 429/503; a `rateLimit` error lets trivia fall through. Descriptive `User-Agent` avoids blocks.
- **[Risk] No cover art for obscure albums.** Many release-groups lack CAA covers. → Candidate fall-through (Decision 2); `notFound` re-rolls. Accepted.
- **[Risk] Album-cover spoilers (text on covers).** → Prompt-layer mitigation (inspection gate + prefer textless iconic covers); documented in the proposal. Not plugin-fixable.
- **[Risk] `license: "unknown"` + copyrighted art.** → Internal-trivia posture, documented; admin's deliberate call (same as Brave).
- **[Risk] Wrong album for ambiguous queries** (covers/reissues with the same name). → release-group granularity reduces this; the inspection gate is the backstop; a wrong-but-plausible cover is a re-roll.
- **[Trade-off] No artist photos.** → By design: Commons covers famous artists; the obscure-artist gap is accepted (Spotify is a future one-adapter swap).

## Migration Plan

No data migration — purely additive (new directory, one tool, no config). Admin enablement: add `"coverart-image-search"` to the `plugins` array in `data/config.json` and restart. No key, no signup.

**Rollback**: remove it from the `plugins` array and restart.

## Open Questions

- **Add a `release`-level fallback when a release-group has no cover?** Some albums have cover art only on a specific release. v1 skips this for simplicity; add a `release` second hop if coverage proves thin.
- **Spotify follow-up for obscure-artist photos?** Out of v1 scope; a free-key OAuth plugin is a clean future add if the Commons artist-photo gap bites.
- **Prefer a larger CAA size (`front-1200`) for render quality?** v1 uses `front-500` (well under the byte cap, renders fine in Slack). Revisit if covers look soft.
