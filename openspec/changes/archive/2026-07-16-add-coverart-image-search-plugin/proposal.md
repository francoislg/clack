## Why

`add-trivia-visual-questions` defines the external image-search MCP tool contract. `add-commons-image-search-plugin` covers public-domain/canonical subjects — including **photos of famous musicians and bands** (The Beatles, Bowie, most trivia-worthy artists have Commons photos). `add-tmdb-image-search-plugin` covers movies/TV/actors. The remaining music gap is **album cover art** — copyrighted artwork that is neither on Commons (copyright wall) nor TMDB (out of domain).

**MusicBrainz + the Cover Art Archive (CAA)** is the canonical, **keyless** source for album covers: MusicBrainz is the open music-metadata database (search by artist/album → stable MBID), and CAA serves the cover image for that MBID. No API key, no usage billing — only the standard descriptive `User-Agent` and a 1 req/sec etiquette (same posture as the Commons plugin's Wikimedia etiquette).

This closes music coverage with zero new keys: **album covers → CAA (this plugin)**, **musician/band photos → Commons (already installed)**. The only uncovered slice is photos of obscure/contemporary artists with no Commons article — an acceptable gap for trivia, which leans on recognizable acts. (Spotify would close that slice but needs a free OAuth key + token-refresh plumbing; deferred as a one-adapter swap if the gap ever matters.)

## What Changes

- **New Clack plugin** at `src/plugins/coverart-image-search/`, registered in the plugin loader. It exposes a single MCP tool: `find_album(query)`. The tool resolves to `mcp__coverart-image-search__find_album` (SDK keeps the hyphenated server name verbatim). **Trivia discovers it by DESCRIPTION, not name** — the description identifies it as a keyless album-cover source, good for "what album is this cover?" with an `artist album` or album-title query.

- **Two-hop, keyless resolution**: (1) search MusicBrainz `release-group` for the query → take the top result's MBID + title + artist credit; (2) fetch the front cover from CAA (`https://coverartarchive.org/release-group/<mbid>/front-500`). When a release-group has no cover art (CAA 404), advance to the next MusicBrainz result; exhausting the candidate budget → `{ kind: "notFound" }`.

- **Tool returns a multimodal result in data mode** (per `add-commons-image-search-plugin` Decision 1): one image content block `{ type: "image", data: "<base64>", mimeType }` (the downloaded cover bytes) + one text block `{ source: "coverart", subjectId, title, imageUrl, license, attribution, format: "data" }`. `imageUrl` is the canonical CAA `front-500` cover URL, preserved for the post-time Slack upload hop.

- **`subjectId` namespacing**: `coverart:rg-<mbid>` (the MusicBrainz release-group MBID — stable, native, dedup-friendly).

- **`title`**: `"<artist credit> – <release-group title>"` (e.g. `"Pink Floyd – The Dark Side of the Moon"`).

- **`license` is the literal `"unknown"`** — CAA hosts copyrighted album artwork (uploaded under promotional/fair-use terms), not CC/PD. **`attribution` is `"via Cover Art Archive"`**. Reveal renders `📷 Image: via Cover Art Archive`. The internal-trivia licensing posture (re-hosted to a private workspace with attribution on reveal) is the same deliberate, documented call established for the dead Brave plugin.

- **Keyless** — no API key, no config. Loads and works out of the box (matching the Commons plugin). Sets a descriptive `User-Agent` on every request per MusicBrainz etiquette, with bounded retry-with-backoff on 429/503 and a 5 MB byte cap on downloads.

- **Structured errors** per the contract: `notFound`, `rateLimit`, `network`, `unsupportedFormat`, `unknown`. (No `keyMissing` — the plugin is keyless.)

- **No persistent storage.** Stateless — each call is a MusicBrainz search + a CAA cover fetch + the image download.

## Capabilities

### New Capabilities

- `coverart-image-search`: the keyless MusicBrainz + Cover Art Archive MCP tool, its contract conformance (multimodal data-mode return, structured errors, `coverart:rg-<mbid>` subjectId namespacing, MusicBrainz/CAA etiquette), album-cover resolution with candidate fall-through.

### Modified Capabilities

(none)

## Impact

- **Code**: new `src/plugins/coverart-image-search/` — `index.ts` (entry + tool registration + i18n labels), `findAlbum.ts` (tool impl: candidate fall-through + metadata + multimodal assembly), `musicbrainz.ts` (HTTP adapter: MusicBrainz search + CAA cover fetch + image-byte download), plus `.test.ts` files. Loader registration mirrors Commons.
- **External dependencies**: MusicBrainz API (`https://musicbrainz.org/ws/2/release-group/`) for search; Cover Art Archive (`https://coverartarchive.org/release-group/<mbid>/front-500`) for covers. Both HTTPS, both keyless. No new npm packages — built-in `fetch`.
- **Configuration**: none. Keyless — the plugin works as soon as it's added to the `plugins` array and the bot restarts.
- **Tests**: mock the MusicBrainz + CAA HTTP layers. Happy path (image block + text block, `coverart:rg-<mbid>` subjectId, `"<artist> – <title>"` title, `via Cover Art Archive` attribution). Candidate fall-through (top release-group has no CAA cover → next selected). All candidates lack covers → `notFound`. Error paths (zero MusicBrainz results, rate-limit retry, 5xx network, oversized image). License/attribution constants.
- **User-visible behavior**: with the plugin installed, visual trivia can ask "what album is this cover?" Combined with Commons (musician/band photos) it gives keyless music coverage. Not installed → unchanged.
- **Licensing posture**: documented in design.md — copyrighted album art, `license: "unknown"`, internal-trivia call (same as Brave/Commons-for-pop-culture).

## Dependencies

Depends on `add-trivia-visual-questions` (the image-search contract) and adopts `add-commons-image-search-plugin` Decision 1 (data-mode return). Complements (does not depend on) Commons and TMDB. Recommended keyless/free-key deployment: Commons (public-domain/canonical + musician photos) + TMDB (movies/TV/actors, free key) + this plugin (album covers, keyless).

## Note on album-cover spoilers

Album covers frequently print the artist and album title — which spoils a "guess the album" question, the same way a movie poster spoils "guess the movie." There is no textless filter for cover art. Mitigation is prompt-layer: trivia's existing image-inspection gate (defined in visual-questions) instructs Claude to reject an image whose visible text gives away the answer and re-roll, and to prefer iconic textless covers (e.g. Dark Side of the Moon, Abbey Road, Nevermind). This is generation-prompt guidance, not a plugin concern.
