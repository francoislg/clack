# coverart-image-search

Album-cover image source for visual trivia, backed by **MusicBrainz** (release-group search) +
the **Cover Art Archive** (front-cover images). Exposes one MCP tool, `find_album(query)`, on the
plugin's always-on default server (`mcp__coverart-image-search__find_album`). Trivia discovers it
by DESCRIPTION — a keyless album-cover source, good for "what album is this cover?".

## Why this source

- **Keyless.** No API key, no signup, no configuration — add `"coverart-image-search"` to the
  `plugins` array in `data/config.json` and restart.
- **Canonical.** MusicBrainz is the open music-metadata database; the Cover Art Archive serves
  the cover for a release-group MBID. `subjectId` is `coverart:rg-<mbid>` — stable and
  dedup-friendly for `find_previous_subjects`.
- **Cover art only.** Musician/band photos come from the `commons-image-search` plugin — this
  plugin does not attempt artist photos (the Cover Art Archive has none).

## Resolution

1. Search MusicBrainz release-groups (album-as-work granularity) for the query.
2. For each of the top candidates (budget: 3), probe the CAA front-500 cover; a 404 (no cover
   art) advances to the next candidate.
3. Download the first cover found (5 MB cap, SVG/non-image rejected) and return it inline
   (data-mode image block) with metadata (`title: "<artist> – <album>"`, `imageUrl`, license,
   attribution).

No cover within the budget, or zero MusicBrainz results → a structured `notFound` error and
trivia re-rolls. All failures are structured errors (`notFound` / `rateLimit` / `network` /
`unsupportedFormat` / `unknown`); the plugin is keyless so there is no `keyMissing` path.

## Licensing posture

The Cover Art Archive hosts **copyrighted album artwork** (uploaded under promotional/fair-use
terms), not CC/PD. The plugin sets `license: "unknown"` and `attribution: "via Cover Art
Archive"`; the trivia reveal renders `📷 Image: via Cover Art Archive`. Re-hosting a cover into a
private workspace with attribution on reveal is a deliberate internal-trivia judgment call — the
same posture as the retired Brave plugin. If your deployment needs a stricter licensing bar, use
the Commons plugin only.

## Etiquette

MusicBrainz and the CAA are keyless but expect a descriptive `User-Agent` (set on every request)
and ≤ 1 req/sec sustained — trivia cadence is far below this. 429/503 responses get bounded
jittered retry-with-backoff, then surface as a `rateLimit` error.

## Album-cover spoilers

Many covers print the artist and album title, which spoils a "guess the album" question. There is
no textless filter — mitigation is prompt-layer: trivia's image-inspection gate rejects an image
whose visible text gives away the answer and re-rolls, and prefers iconic textless covers (Dark
Side of the Moon, Abbey Road, Nevermind). Not a plugin concern.
