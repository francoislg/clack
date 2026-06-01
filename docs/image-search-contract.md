# Image-search plugin contract

The trivia plugin's **visual questions** feature (`promptMedium: "image"`) sources images from
external, independently-installed Clack plugins. Trivia contains **zero** image-source code — no
registry, no router, no adapter directory. Instead, any plugin that exposes an MCP tool matching
this contract becomes an image source that trivia's question-generation prompt can use.

This document is the contract those plugins MUST follow. Shipped implementations:
`commons-image-search`, `brave-image-search`.

## Enabling visual trivia rounds (admins)

Two steps, both required:

1. Set `promptMedium.image > 0` at some cascade tier (`config.trivia.promptMedium`, a season, a game,
   or a slot) — e.g. `"promptMedium": { "text": 3, "image": 1 }` for ~25% visual.
2. Install at least one image-search plugin. Start with `commons-image-search` (free, keyless — good
   coverage of flags, people, landmarks, paintings).

Visual coverage depends on which plugins are installed: keep your `categories.json` pool aligned with
what your installed plugins cover well. An image roll on a poorly-covered category simply re-rolls to a
text question (graceful — no error). With `image` weight at 0 (the default) **or** no image-search
plugin installed, behavior is identical to text-only trivia.

## Tool naming

Any MCP tool whose **name contains the substring `image_search`** is treated as an image-source
provider by trivia's visual-research subflow. Examples:

- `mcp__commons_image_search__find_subject` — Wikipedia / Wikimedia Commons
- `mcp__brave_image_search__find_image` — Brave Search Images (generic web)
- `mcp__tmdb_image_search__find_movie` — TMDB (hypothetical future plugin)

Register the tool on the plugin's **always-on default server** (`sdk.registerTool(...)`) so it is
available to trivia's scheduled-run prompt without an `attach_integration` step.

## Argument contract

Each image-search tool SHALL accept at minimum:

- `query: string` (required, non-empty, ≤ 200 characters) — the subject hint. Reject empty/oversized
  queries with a structured error (below).

Tools MAY accept additional optional args (e.g. `category`, `imageKind`). Trivia's prompt is agnostic
— it reads the tool's description to decide how to invoke it.

## Return contract — multimodal data-mode result

On success, return a multimodal MCP tool result with **both** content blocks:

1. **An image content block** in the MCP `CallToolResult` shape — base64 bytes:

   ```ts
   { type: "image", data: "<base64>", mimeType: "image/<jpeg|png|webp|gif>" }
   ```

   Download the upstream image, base64-encode it (cap 5 MB; raster only — reject SVG), and return the
   bytes inline so Claude can SEE and inspect the picture.

   > **There is no URL-source mode.** The MCP tool-result content union expresses an image ONLY as
   > `{ type: "image", data, mimeType }`. `source: { type: "url" }` is the Anthropic Messages-API
   > shape, not a tool-result shape — it is not expressible here. (See `commons-image-search`
   > `design.md` Decision 1 and the repo precedent `src/tools/query/viewSlackImage.ts`.)

2. **A text content block** carrying metadata JSON:

   ```json
   { "source": "<plugin-name>",
     "subjectId": "<source-namespaced-id>",
     "title": "<canonical title>",
     "imageUrl": "<upstream HTTPS URL — always populated>",
     "license": "<license string, optional, may be 'unknown'>",
     "attribution": "<attribution string, optional>",
     "format": "data" }
   ```

   `imageUrl` MUST always be populated — trivia's `post_questions` re-fetches it to re-host the image
   on Slack with a neutral filename (the inline bytes are for Claude's inspection only). `format` is
   always `"data"`.

### Source-namespaced `subjectId`

Prefix `subjectId` with a stable source identifier so trivia's `find_previous_subjects` dedup works
without cross-source normalization. Examples:

- `commons:File:Eiffel_Tower.jpg` or `wikidata:Q243`
- `tmdb:m-550` / `tmdb:tv-1399` / `tmdb:p-287`
- `brave:<sha256-of-imageUrl, first 12 chars>` (generic search — URL hash, no native id)

Cross-namespace matching is NOT performed: `tmdb:m-550` and `wikidata:Q172241` are distinct keys even
if they name the same subject. Accepted tradeoff.

## Error contract

On failure, return a structured error result with a `kind` from this discriminated union:

```ts
{ kind: "notFound" | "rateLimit" | "network" | "tooLarge" | "unsupportedFormat" | "unknown" | "keyMissing",
  message: string }
```

- Reject empty/oversized `query` with a structured error (`notFound` is acceptable).
- Oversize (> byte cap) may be reported as `tooLarge` or `unsupportedFormat` — the shipped plugins
  use `unsupportedFormat`. Trivia treats every kind identically (re-roll), so the distinction is
  informational.
- `keyMissing` (unset API key) tells trivia the tool is unavailable for the run; the prompt tries the
  next available image-search tool.

## What the plugin owns

Each plugin handles its own: HTTP fetching + byte download, rate-limit / retry / backoff, license +
attribution extraction, API-key configuration. Trivia neither knows the list of installed plugins nor
routes between them — Claude inspects its tool list at runtime and picks per the rolled category.
