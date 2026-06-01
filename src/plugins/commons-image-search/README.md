# commons-image-search

A keyless image-search plugin for visual trivia, backed by **Wikipedia REST** (`/page/summary`) and the **Wikimedia Commons API** (`imageinfo`). It exposes one MCP tool — `mcp__commons_image_search__find_subject(query)` — that the trivia visual-questions subflow discovers at runtime by the `*_image_search__*` naming convention.

## What it handles well

Canonical subjects that have their own English-Wikipedia article:

- Flags and country symbols
- World leaders, historical figures
- Landmarks and monuments
- Paintings and sculptures
- Currencies (notes/coins)
- Animals (when the species has a Wikipedia article)

## What it does NOT handle

- **Pop-culture / copyrighted subjects** (album covers, movie scenes, brand logos) — these hit copyright walls on Commons. Use a different image-search plugin (e.g. Brave Search Images) for the long tail.
- **Non-English subjects** — v1 queries `en.wikipedia.org` only.
- **SVG-only subjects** — the plugin always uses the rasterized `thumbnail.source` (PNG/JPEG), never the `originalimage.source` SVG master, so flags/coats-of-arms render in Slack. The rare case where even the thumbnail is SVG returns `unsupportedFormat`.

## Install

No API key, no configuration. Add `"commons-image-search"` to the `plugins` array in `data/config.json` and restart. The tool loads on the plugin's always-on default server (no `attach_integration` needed), so trivia's scheduled run can call it directly.

## How it returns images

The tool downloads the thumbnail and returns it as a **data-mode** image content block (base64 `data` + `mimeType`) so Claude can inspect it inline, alongside a text block with `{ source, subjectId, title, imageUrl, license, attribution, format: "data" }`. `imageUrl` is preserved so trivia's `post_questions` file-upload hop can re-fetch the same thumbnail at post time. `subjectId` is `wikidata:Q<n>` when the article has a Wikidata QID, else `wikipedia:<slug>`.

## Wikimedia etiquette

Every request sets a descriptive `User-Agent` (`Clack-Trivia-Image-Search/1.0`) per the [Wikimedia User-Agent policy](https://meta.wikimedia.org/wiki/User-Agent_policy), times out after 5 s, and backs off on `429`/`503` (bounded jittered retry). The plugin is stateless — no cache, no persisted bytes; Wikimedia's CDN handles upstream caching.
