# brave-image-search

A generic web-image-search plugin for visual trivia, backed by the **Brave Search Images API**. It exposes one MCP tool — `mcp__brave-image-search__find_image(query)` — discovered by trivia's visual-questions subflow via the tool's **description** (it self-identifies as an image source returning an inline image plus metadata; tool names are not matched). It is the **last-resort fallback** for the long tail that the Commons plugin can't cover.

## What it's for

The long tail of visual subjects with no clean canonical source:

- Movie scenes / TV stills
- Video game character art, anime/comic characters
- Contemporary pop culture
- Regional figures missing from English Wikipedia
- Arbitrary generic subjects ("smiling capybara in a hot spring")

For canonical subjects (flags, world leaders, landmarks, paintings, currencies, animals), prefer **commons-image-search** — it returns stable IDs and real license metadata. Claude picks between installed image-search tools by reading their descriptions.

## Install

1. Sign up at <https://search.brave.com/api> for a free API key (~2000 queries/month, ~1 req/sec).
2. Add `BRAVE_API_KEY=<your-key>` to `data/auth/.env` (same convention as the other media plugins).
3. Add `"brave-image-search"` to the `plugins` array in `data/config.json` and restart.

The plugin **loads even without a key** — every `find_image` call then returns `keyMissing`, and trivia silently falls through to another image-search tool (or to a text-medium question). Add the key later and restart; no other change needed.

## How it returns images

The tool searches Brave, picks the top renderable result (JPEG/PNG/WebP/GIF; SVGs and oddities are skipped, top-10 cap), downloads it, and returns it as a **data-mode** image content block (base64 `data` + `mimeType`) so Claude can inspect it inline — alongside a text block with `{ source: "brave", subjectId, title, imageUrl, license: "unknown", attribution, format: "data" }`. `subjectId` is `brave:<first-12-hex-of-sha256(imageUrl)>` (deterministic per URL). `attribution` is `via <source-page-domain>` (e.g. `via imdb.com`), falling back to `via Brave Search`.

> **Note:** the MCP tool-result type only supports data-mode image blocks (URL-source blocks aren't expressible), so the plugin downloads the selected image even though the original proposal described URL mode.

## Licensing posture (read before enabling)

Brave Search indexes the open web; results may include copyrighted content, and Brave does not return licensing metadata — `license` is therefore always `"unknown"`. This plugin does **not** enforce any license-side filtering. Admins enabling it accept the posture documented in [`design.md` Decision 4](../../../openspec/changes/add-brave-image-search-plugin/design.md): trivia images are re-hosted via Slack to a **private workspace** audience with attribution shown on reveal — functionally equivalent to a person sharing a public image link in a Slack channel for a fun internal game. Admins who don't want this posture should not install this plugin; **commons-image-search** remains the canonical-only option.

## Quota & rate limits

Free tier is ~2000 requests/month, ~1 req/sec. On `429` the plugin retries once (jittered ~1s backoff) then surfaces `rateLimit`; trivia moves on. Track remaining quota via Brave's own dashboard. The plugin is stateless — no cache, no persisted bytes.
