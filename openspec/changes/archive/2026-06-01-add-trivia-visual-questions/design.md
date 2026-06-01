## Context

`add-trivia-topical-questions` established the orthogonal-axes pattern: `answersFormat` (boolean | choice) describes the *answer shape*, `questionType` (fact | topical) describes the *knowledge source*, and `contexts` describes the *flavor/lens*. Each axis has its own weight map at three cascade tiers (`slot → season → config → default`), each is independently rolled in `get_ideas`, and each produces its own `suggested*` hint that Claude branches on in the prompt.

Visual questions don't fit any of those axes:

- Not an answer shape — visual questions still use choice scoring.
- Not a knowledge source — a visual question can be about static facts (animals, landmarks) OR current events (a photo from yesterday's news).
- Not a flavor/lens — flavor describes *angle*, not *delivery medium*.

They're a separate concern: **the medium the question prompt is delivered in.** Text vs image. Naming it `promptMedium` makes the relationship explicit (the *prompt*, not the answer, is what changes).

This is most plainly seen by the combo that orthogonality unlocks: a photo of a recent news event is *both topical and visual*. A `questionType: "visual"` value would foreclose that combo; a separate `promptMedium` axis preserves it.

The codebase already has every machinery piece needed: cascade resolution (`src/plugins/trivia/domain/questionTypes.ts` pattern), server-side rolls fed to Claude through `get_ideas`, Slack file uploads (`src/slack/handlers/homeTab.ts:877`), and the existing card / hero_image block surface. This change extends those patterns without inventing new architecture.

Stakeholders: admins who configure trivia games (one new optional axis + one new optional category pool), end users (zero visible change unless an admin enables it), Claude (two new prompt paths sharing a common visual-research subflow).

## Goals / Non-Goals

**Goals:**

- Add `promptMedium: text | image` as a third orthogonal axis using the same cascade pattern the topical proposal established.
- Support all three image templates: identification (image+choice), claim-based (image+boolean), and typed-identification (image+freeform). All 12 axis combinations are permitted.
- **Decouple image sourcing from trivia.** Define the external image-search MCP tool contract; image-source code lives in separate plugins, each landing as its own OpenSpec change. Trivia contains zero source-specific logic.
- Mandate Slack file re-hosting before posting to prevent URL/filename leak.
- Provide subject-level dedup (`find_previous_subjects`) since statement-level dedup is useless for templated visual prompts.
- Surface attribution in the reveal to honor source license terms.
- Graceful fallback when no image-search plugin is installed or all available ones miss — re-roll the question as text-medium.
- Keep zero-configuration behavior identical to post-freeform: a deployment that doesn't set `promptMedium.image > 0` generates the same questions it does today, with or without image-search plugins installed.
- No migration. Additive, optional fields only.

**Non-Goals:**

- **Shipping any specific image-search adapter.** Brave, Commons, TMDB, Jikan, etc. are EACH their own separate OpenSpec change. This proposal ships only the contract and the trivia-side machinery.
- **Topical event photos** (the actual news event, not a stock photo of the subject). News photos are copyright-locked and indexing-lagged on all free sources. Visual+topical questions use canonical subject images (e.g., a leader's portrait) grounded by WebSearch-discovered events. Per-plugin proposals MAY ship news-image sources later.
- **Brand logos** and **comics panels/covers**. Logos hit a copyright wall on every free source. Comics: ComicVine has unclear licensing, Marvel API is Marvel-only with non-commercial restrictions, no clean DC source. Per-plugin proposals MAY add these later with explicit licensing posture.
- Audio or video prompts. Reserved as future values of `promptMedium`; this change ships `text | image` only.
- Per-`questionType` `promptMedium` weights (e.g., "only allow image on topical"). Out of scope; weights are flat at each cascade tier.
- Cheating mitigations specific to reverse-image-search. Visual questions are inherently more cheatable than text; the existing cheat-detection machinery remains the only line of defense for v1.
- Server-side image-content validation in trivia. The image-inspection step is a prompt-level Claude self-check, not a server-side validator.
- A trivia-internal source registry, router, priority table, or `visualSources/` directory. All deferred — image plugins self-register via MCP tool exposure.

## Decisions

### Decision 1: `promptMedium` as a third orthogonal axis, not a value of `questionType`

`promptMedium: "text" | "image"` is added as a new top-level field on `TriviaQuestion`, with weights at `config.trivia.promptMedium`, `SeasonEntry.promptMedium`, and `SeasonFormatSlot.promptMedium`. Default `{ text: 1, image: 0 }`.

**Why not `questionType: "fact" | "topical" | "visual"`?** Two reasons:

1. **Composability.** A photo of a recent news event is both topical and visual. Squeezing visual into `questionType` makes the combo inexpressible — you'd have to pick one. As a separate axis they multiply.
2. **Categorical fit.** `questionType` describes knowledge *source* (static vs current). Visual is about *medium*, not source. Forcing them into one enum mixes concerns.

**Why not a parallel boolean flag (`visual: true`)?** Same argument the topical proposal made against `topical: boolean`: a flag isn't a weight. Symmetric data is easier to reason about and extend; making `promptMedium` a proper weighted axis mirrors the existing pattern.

### Decision 2: All 12 axis combinations are permitted; image medium splits into three sub-templates

`answersFormat` now has three values (`boolean | choice | freeform` — freeform added by `add-trivia-freeform-questions`). The 3-axis matrix has `3 × 2 × 2 = 12` cells, **all active**. Image medium is not weaker than text medium — it has its own three sub-templates:

```
                       text                    image
fact + boolean      │ existing               │ NEW visual+fact+bool        │
fact + choice       │ existing               │ NEW visual+fact+choice      │
fact + freeform     │ freeform proposal      │ NEW visual+fact+freeform    │
topical + boolean   │ topical proposal       │ NEW visual+topical+bool     │
topical + choice    │ topical proposal       │ NEW visual+topical+choice   │
topical + freeform  │ freeform+topical combo │ NEW visual+topical+freeform │
```

**The governing principle — the image IS the question.** For an image-medium question to be valid, the image MUST be the primary referent: removing it must break the question. The image is not illustration, decoration, or visual support for a text question — it is the question's subject. A question whose answer is unchanged when the image is removed is a text question with a picture stuck on, not a visual question.

Concretely:

- **Valid (image IS the question):**
  - "Who is this?" + portrait → can't answer without the image.
  - "This is the flag of Ecuador. T/F" + flag image → you must look at the image and recall what Ecuador's flag looks like to evaluate.
  - "This bird species is native to Europe. T/F" + photo of a Cardinal (North American) → you must identify the bird from the image to know the claim is false.

- **Invalid (image is decoration):**
  - "Birds have hollow bones. T/F" + bird photo → claim is true regardless of which bird is shown.
  - "The capital of France is Paris. T/F" + Eiffel Tower photo → image is decorative.
  - "How many planets are in our solar system?" + Saturn photo → image is unrelated to the answer.

The prompt MUST enforce this principle for both templates. The visual research subflow returns a *primary subject* whose image is shown; the statement MUST be about that subject (its identity, its attributes that the image evidences, or things that require identifying it from the image first).

**The three image templates:**

- **image+choice → identification template.** "What is this?" + N candidate names. The image is the subject; the distractors are alternative identities. Removing the image makes the question unanswerable.
- **image+boolean → claim template.** "This is the flag of Ecuador. T/F." The image is what the claim is about; evaluating the claim requires looking at the image AND knowing the correct identification. The distractor lives in the claim. Strongest forms:
  - **Identity swap** (preferred when there's a clear confusable): "This is the flag of Colombia" shown an Ecuador flag. Best for flags (Romania/Chad), currency, similar species (cheetah/leopard, frog/toad), lookalike landmarks.
  - **Image-grounded property claim** (when no clear confusable exists): "This species is native to Africa" shown a Cardinal (it's North American). The property MUST require identifying the subject from the image to evaluate — generic facts about the broader category ("Birds have feathers") are decoration, not visual questions.
- **image+freeform → typed-identification template.** "Who is this?" / "What animal is this?" / "Which landmark is shown?" + text input. Probably the strongest visual shape: no multi-choice options to leak hints, no T/F polarity to game. `expectedAnswer` is the subject's title from the image-search tool's metadata `title` field. `acceptableAnswers` can be populated with observed variants when applicable (e.g., "Eiffel Tower" / "La Tour Eiffel" / "tower of Eiffel"; "Mount Everest" / "Sagarmatha" / "Chomolungma"). The reveal-time Haiku judge handles spelling forgiveness, alternate forms, and the multi-guess rejection rule (e.g., "Eiffel Tower or Big Ben" is rejected with `multiple-guess`).

For image+boolean, the existing boolean-flow polarity gate still applies: when `suggestedAnswer === false`, the statement asserts a plausible-but-wrong claim about the image (identity swap or image-grounded property). When `suggestedAnswer === true`, the statement asserts a correct identification or image-grounded property.

For image+freeform, no polarity gate applies (freeform has no suggested answer to roll). The plausibility gate also doesn't apply (no distractors to score). The image-is-question gate (Decision 2 principle) is the only quality bar besides the difficulty gate.

**Why no cross-axis constraint?** Initial design forbade image+boolean on the assumption that "Is this X?" degenerates to a no-trap question. That's wrong for confusable subjects — recognizing a country's flag vs. its lookalike is a real recall test, harder than choice (where the wrong options are visible to recognize) because the user must hold the correct flag in memory and compare. Hard-forbidding the combo would foreclose a meaningfully different game shape.

**Implication for `get_ideas` and `save_question`.** Both axes roll independently with no constraints between them. No server-side re-roll. No save-time cross-axis rejection. The only validation that touches `media` is "present iff `promptMedium === image`" (covered in Decision 1's record shape). The "image IS the question" principle is enforced *in the prompt* — at the question-writing gates, not at storage — because it's a content-quality rule that requires reading the statement against the image, which only Claude can do.

### Decision 3: Image medium reuses the standard category pool — no separate visual pool

Image-medium questions draw `categories.ideas` from the existing `data/plugins/trivia/categories.json` pool, using the same season/slot cascade and recent-exclusion window as text-medium questions. There is no `visualCategories.json`, no `SEED_VISUAL_CATEGORIES`, no `pool` argument on `add_categories`/`remove_categories`, and no `get_ideas`-side empty-pool fallback. `get_ideas` rolls `suggestedPromptMedium` independently and returns category ideas from the one pool regardless of the rolled medium.

**Why not a separate `visualCategories.json` pool?** A parallel curated pool was the original design. It was rejected for three reasons:

1. **It duplicates information now owned by installed plugins.** After the image-sourcing pivot (Decision 5), whether a category is "visual-capable" depends on which `*_image_search__*` plugins are installed — listing "Movies" in a visual pool means nothing if no TMDB-style plugin is present. A hand-maintained visual allowlist is a second source of truth that silently drifts from what the installed plugins can actually serve.
2. **It is the source of most edge-case complexity.** The separate pool dragged in an empty-pool fallback, a `pool` argument across two category tools, a season-intersection rule, and a compound gate-ordering case — all of which evaporate when image and text share one pool.
3. **The misfit it guarded against is already handled.** The concern was that an image roll could land on a fundamentally non-visual category (Cryptography, Philosophy, Mathematics). That is absorbed by the visual research subflow's existing re-roll budget (Decision 8.5 / 9): when no good visual subject exists for the rolled category, Claude re-rolls candidates, then re-rolls to a different category, then falls back to text — the same graceful degradation used for the no-image-tool case.

**Cost accepted.** Reusing the shared pool means image rolls can occasionally land on a non-visual category and burn part of the research-subflow retry budget (a few image-search / WebSearch calls) before falling back to text. This wasted work is the price of dropping the parallel pool; in practice admins who enable visual rounds keep their `categories.json` skewed toward visual-friendly categories, which minimizes it.

### Decision 4: Mandatory Slack file re-hosting via `files.uploadV2`

Before posting a question with `media`, `post_questions` SHALL download the upstream image and re-upload it via `files.uploadV2` with a neutral filename (`trivia-q-<questionId>.<ext>`). The re-uploaded file's permalink (or Slack file reference) is stored on the record as `media.slackFileId` and used in the rendered `hero_image`.

**Why mandatory?** Slack's link unfurl and hover preview expose image URLs even when the rendered card looks clean. A Commons URL like `.../Eiffel_Tower.jpg` is a giveaway — the answer is in the URL. Re-hosting strips the filename. This isn't a v2 polish; without it, half of visual questions are degenerate.

**Why not use a proxy URL endpoint?** Would add infrastructure (a route, a route handler, an image cache or pass-through). Slack file upload is one HTTP call against an API the bot already uses, and the asset is then served by Slack's CDN with all the cache/preview infrastructure for free.

**Idempotency.** When `media.slackFileId` is already set (e.g., on a re-post / replay), `post_questions` skips the upload and reuses the existing file reference. Same shape as the existing `postedAt` idempotent-skip logic.

**The card-injection seam.** The prompt does NOT build the `hero_image` block. The card it constructs has only `title`, `body`, and optional `subtitle` — no `hero_image`, no upstream URL. After uploading the image and stamping `media.slackFileId`, `post_questions` injects `hero_image: { type: "image", image_url: <slack-hosted-url>, alt_text: <question.media.altText> }` into the card. This keeps the prompt unaware of Slack URLs entirely — no sentinel strings, no URL rewriting, no synchronization between prompt-built cards and tool-rewritten cards. The prompt knows about `media` only to the extent of writing the question's statement; the card mutation is `post_questions`'s sole responsibility.

**Which Slack URL goes in `image_url`?** `files.uploadV2` returns multiple URLs (`url_private`, `permalink`, `permalink_public`). `image_url` in Block Kit requires a URL Slack can render inline for everyone in the channel. Implementation should use the response's `permalink` (workspace-internal share link, works for all channel members without making the file public) and fall back to a `slack_file: { id: <file_id> }` reference if `permalink` doesn't render cleanly in a `hero_image` block. The choice is implementation-level; the contract on `media.slackFileId` storage is just "whatever post_questions needs to re-render the card without re-uploading."

**License compatibility.** Wikimedia Commons content is overwhelmingly CC-BY-SA. Slack file uploads are private to the workspace — this is a re-distribution to a closed audience, with attribution shown on reveal, which satisfies CC-BY-SA terms in practice. Not legal advice; admins enabling visual rounds tacitly accept that posture, same as for any other UGC re-share.

### Decision 5: External image-search MCP tool contract — image sources live in separate plugins, Claude routes

Trivia does NOT contain image-source code. There is no internal registry, no router, no adapter directory inside the trivia plugin. Instead, image sources are independent Clack plugins that expose MCP tools matching a documented contract. Claude — during the question-generation prompt — looks at its available tool list, picks an image-search tool appropriate for the rolled category, calls it, and inspects the returned image inline.

**Tool naming convention.** Any MCP tool whose name contains the substring `image_search` is treated as an image-source provider:

- `mcp__commons_image_search__find_subject(...)` — Wikipedia / Wikimedia Commons
- `mcp__brave_image_search__find_image(...)` — Brave Search Images (generic web)
- `mcp__tmdb_image_search__find_movie(...)`, `mcp__tmdb_image_search__find_tv(...)` — TMDB
- `mcp__jikan_image_search__find_anime(...)` — Jikan / MyAnimeList
- ...and so on for any future provider.

The trivia prompt scans the available tool list at runtime (whichever image-search plugins are installed and configured) and chooses based on the tool's description plus the rolled category. Plugins not installed simply don't appear in the tool list.

**Argument contract.** Each image-search tool SHALL accept at minimum:

- `query: string` (required) — the subject hint to search for. May be a name ("Eiffel Tower"), a description ("smiling capybara on grass"), or a category-qualified term. Plugins MAY also accept `category: string` for category-aware routing, but `query` is mandatory.

Plugins MAY accept additional optional arguments (e.g., TMDB's `imageKind: "poster" | "still"`). Trivia's prompt is agnostic — it reads the tool's description and follows whatever shape the plugin documents.

**Return contract — multimodal data-mode result.** On success, each image-search tool SHALL return a multimodal MCP tool result containing both:

1. **An image content block** so Claude can SEE the pixels for inspection, in the MCP `CallToolResult` image shape: `{ type: "image", data: "<base64>", mimeType: "image/<type>" }`. The plugin downloads the upstream image, base64-encodes it (cap 5 MB, restrict to JPEG/PNG/WebP/GIF — SVG rejected), and returns the bytes inline.

2. **A text content block** carrying structured metadata as JSON:

   ```json
   { "source": "<plugin-name>",
     "subjectId": "<source-namespaced-id>",
     "title": "<canonical title>",
     "imageUrl": "<upstream URL — always populated>",
     "license": "<license string, optional, may be 'unknown'>",
     "attribution": "<attribution string, optional>",
     "format": "data" }
   ```

   `imageUrl` is ALWAYS populated — `post_questions` uses it later to re-fetch and upload to Slack with a neutral filename. The plugin downloaded the bytes for Claude's inspection; `post_questions` re-fetches the URL for the upload. `format` is always `"data"` (retained as a forward-compat discriminator).

On failure, the tool SHALL return a structured error result with one of these discriminator kinds: `notFound`, `rateLimit`, `network`, `tooLarge`, `unsupportedFormat`, `unknown`, `keyMissing`. Trivia's prompt handles these uniformly — retry the same tool with a different query, try another tool, or fall back to text.

**Why data mode and not URL mode?** An earlier draft made URL mode (`source: { type: "url", url }`) the preferred default so plugins wouldn't have to proxy bytes. **That shape is not expressible in an MCP tool result.** The MCP `CallToolResult` content union (returned by the Claude Agent SDK's `tool(...)` helper, sourced from `@modelcontextprotocol/sdk`) expresses an image ONLY as `{ type: "image", data, mimeType }`; `source: { type: "url"/"base64" }` is the Anthropic Messages-API content shape, not the tool-result shape. The repo precedent `src/tools/query/viewSlackImage.ts` confirms base64-only. This was the blocking dependency flagged by tasks 7b.1/7b.2 and resolved by `add-commons-image-search-plugin`'s design (Decision 1) in favor of data mode. Consequences accepted: each plugin makes one extra HTTP call to download the image, and `post_questions` re-fetches `imageUrl` at post time (the inspection-time bytes and the post-time upload don't share state — the upstream CDN serves both cheaply).

**`subjectId` is source-namespaced** so trivia's `find_previous_subjects` dedup works without normalization across sources. Examples that plugins SHOULD follow:

- `commons:File:Eiffel_Tower_at_night.jpg` or `wikidata:Q243` (the Commons plugin prefers QID when available)
- `tmdb:m-550` (movie), `tmdb:tv-1399` (series), `tmdb:p-287` (person)
- `inaturalist:46327`
- `mbid:550e8400-e29b-41d4-a716-446655440000` (Cover Art Archive uses MusicBrainz UUIDs)
- `jikan:1` (Cowboy Bebop), `jikan:c-1` for characters
- `openlibrary:OL45883W` (work), `openlibrary:OL27448M` (edition)
- `nasa:PIA12345`
- `met:436532`
- `brave:<sha256-of-imageUrl, first 12 chars>` (URL hash, since generic search has no native canonical ID)
- `openverse:<id>` (last-resort identifier when no source-native ID is meaningful)

**Cross-source dedup is per-namespace.** `tmdb:m-550` and `wikidata:Q172241` may refer to the same movie (Fight Club) but `find_previous_subjects` treats them as distinct keys. We accept this as a rare-event tradeoff: page renames / ID drift between source ecosystems make automated mapping unreliable, most subjects will route to one preferred source, and the image-inspection step gives Claude a secondary signal ("I've seen this before from the image alone").

**Why Claude routes instead of a server-side registry?**

1. **Claude is good at this.** It reads tool descriptions and picks the right one for the category. Hard-coding routing rules in trivia would lock the system to a v1 source list and force every new plugin to ship trivia-side config changes.
2. **No SDK additions, no platform router.** Each image source is just a normal Clack plugin exposing MCP tools — the existing plugin loader handles install/uninstall. Trivia is just one consumer of those tools.
3. **Multimodal inspection is in the loop.** Claude calling the tool and seeing the image is one turn. A server-side router that returned the image to trivia, then trivia returned it to Claude, would add no value and lose the natural inspection beat.
4. **Graceful degradation.** When no image-search plugin is installed, Claude's tool list contains no `*_image_search__*` tool, the prompt detects that and re-rolls to text. No errors, no special handling.

**Wikipedia thumbnail.source vs originalimage.source — a Commons-plugin concern, not trivia's.** The Commons image-search plugin (separate proposal) is responsible for preferring `thumbnail.source` (rasterized PNG/JPEG) over `originalimage.source` (often SVG masters for flags). This single rule fixes the flag-trivia use case — but it lives in the Commons plugin, not in trivia.

**Why not generic stock photo sources (Pexels/Unsplash/Pixabay)?** They return aesthetic photos but not *subject-canonical* ones. A search for "capybara" on Unsplash returns a beautifully-shot capybara by a hobbyist — no guarantee it's THE representative capybara photo for "what species is this?" trivia. Plugin authors are free to ship Pexels/Unsplash plugins if they want, but the trivia contract favors canonical sources (Wikipedia/iNat/TMDB/etc.) plus Brave-style generic search for long-tail fallback.

**Image-storage posture: zero persistent storage in trivia.** Image bytes flow through memory only. The image-search plugin downloads them (one HTTP fetch), returns them in the multimodal tool result for Claude's inspection, and they go out of scope at the end of the prompt run. At post time, `post_questions` re-fetches from `media.url` (upstream) and uploads to Slack via `files.uploadV2`. Slack hosts the asset on its CDN; trivia's question record stores only string fields (`media.url`, `media.slackFileId`, `media.altText`, etc.). No image bytes ever land on the trivia plugin's disk. Disk impact per question is the same magnitude as the existing `statement` / `messageLink` fields.

**Alternative considered:** Image-content hash as the dedup key. Rejected — the same subject can be illustrated by multiple equally-valid images from the same source, and we want subject-level dedup, not image-level. A user being asked "what is this animal?" with photo A and the same question with photo B months later is a duplicate question regardless of the bytes.

### Decision 6: No migration — `promptMedium` and `media` are optional, additive fields

`promptMedium` is absent from legacy `TriviaQuestion` records and from configurations that don't opt in. Read sites SHALL treat absent `promptMedium` as `"text"`. `media` is absent when `promptMedium === "text"` (or absent).

**Why no migration?** Three reasons:

1. **Additive only.** No fields are renamed or restructured. Every read can default `promptMedium` to `"text"` locally and produce identical behavior.
2. **Boot-blocker cost.** Blocking boot migrations are expensive operationally (downtime risk, rollback complexity). They're justified for renames where two field names would coexist confusingly, but not for purely additive fields.
3. **The topical proposal already pays the migration tax.** Layering a second blocking migration immediately after topical doubles the risk surface and the rollback complexity. Visual sidesteps that entirely.

**Cost of "absent reads as text":** A handful of read sites need to apply the default. The same convention is already used for legacy `type`-absent records reading as `"boolean"`, so this is a known pattern.

**Trade-off:** Older records have no recorded medium, so retrospective analytics ("what % of historical questions were visual?") need to lean on `media !== undefined` as a proxy. Acceptable.

### Decision 7: Subject-level dedup via a dedicated tool

A new `find_previous_subjects({ subjectId })` MCP tool searches saved questions by `media.subjectId`. The visual-path prompt calls this immediately after the image-search tool returns (parsing `subjectId` out of the metadata text block) to check whether the chosen subject has been asked about before. If hit, re-roll.

**Why a dedicated tool rather than extending `find_previous_questions`?** Two reasons:

1. **Semantic clarity.** `find_previous_questions` searches text. The dedup signal for visual is structurally different — it's a key match, not a substring search. Mixing them muddles the tool's contract.
2. **Performance.** Filtering by `media.subjectId === X` is an exact match on an indexable field; the in-memory loop is cheap. A future move to a real index doesn't require changing the tool's shape.

**What about same-image dedup (different subjects, same Commons file)?** Rare but possible (one Commons image used as the canonical illustration for two related Wikidata items). Out of scope; subject-level is the right primary key and image-level edge cases can be addressed if they actually occur.

### Decision 8: Attribution rendered in reveal, not in the question card

When a revealed question has `media`, the reveal block layout includes one extra `context` block above the closer: `"📷 Image: <attribution> · <license>"`. The question card itself stays clean — no attribution byline, because that's visual clutter at posting time and an easy place to leak hints about the subject.

**Why?** Wikimedia attribution often contains the subject name (`"Eiffel Tower at night by [photographer]"`). Showing it at posting time defeats the question. Showing it at reveal time satisfies the license requirement and adds an educational beat to the reveal ("here's where you can learn more about this subject"). Slack mobile users seeing the question card don't get attribution; users who view the reveal do.

**Trade-off:** Strict CC-BY-SA reading might argue attribution should appear *with* the work, not separately. We treat the question+reveal pair as a single editorial unit (they're posted in the same thread) and put attribution on the reveal half. If this posture proves insufficient, attribution can be moved to a small bottom-of-card context block at posting time — but only after pruning the subject name from the attribution string.

### Decision 8.5: Claude inspects the image before writing the question

Every image-search plugin's tool result includes a base64 image content block (`{ type: "image", data, mimeType }`, per Decision 5) alongside the metadata text block. Claude SHALL perform an **image inspection step** as part of the visual research subflow, BEFORE writing any statement or distractors. The inspection evaluates four things:

1. **Subject match.** Does the image actually depict what the metadata claims? (Wikipedia's "main image" is occasionally a diagram, a coat of arms, a map, or a tangentially-related photo rather than a canonical subject photo.)
2. **Subject clarity.** Is the subject clearly visible? (No heavy obstruction, multiple competing subjects, low resolution, ambiguous angle.)
3. **Answer leakage.** Does the image contain text, captions, watermarks, or labels that would reveal the answer? (E.g., a flag image with the country name in the caption baked into the JPEG; a team photo with the team name on jerseys; a museum placard.)
4. **Distinguishing features.** What's visually evident that Claude can write a claim about? (For the boolean claim template, this informs the identity-swap choice — Claude needs to know what features make the image confusable with similar subjects.)

If any of (1), (2), or (3) fail, Claude SHALL re-roll: call the same image-search tool with a different query, or switch to a different image-search tool (if multiple are installed and the category has fallbacks), or move to a different subject within the category. The failure mode is silent — no error from the tool, just a re-roll, the same way the duplicate-detection step works.

**Why does this need to be a discrete step?** Without inspection, Claude is writing questions about its *expectation* of the image rather than the *actual* image. The failure mode looks like: question says "Who is this?" with 4 choices, but the Wikipedia main image for the subject is actually a coat of arms (because that's what the article uses), so the question is unanswerable from the image. Or: the false-polarity claim "This is the flag of Colombia" assumes the user sees a flag, but the article's main image is a map. Inspection catches this before the question ships.

**Why inline in the tool result, not a separate `inspect_image` tool?** Two reasons:

1. **Latency.** A separate tool call adds a round-trip with no information gain — Claude is going to inspect the image right after the image-search tool returns regardless. Returning the image block in the same tool result collapses two tool calls into one.
2. **Coupling.** The image is part of the subject, not a separate resource. The tool result that says "here is the subject I found" should include the image that comes with it.

**Tool-side reliability is each plugin's concern.** The failure modes (404, rate-limit, too-large, unsupported format) are handled inside the plugin during its byte download and surfaced as structured errors. Trivia's prompt just inspects the returned image block and re-rolls on failure.

### Decision 9: Prompt branches as a 3-axis matrix; visual paths share research, split on statement-writing

By the time this change ships, `SEND_QUESTIONS_INSTRUCTIONS` already covers a 6-path matrix (`{boolean, choice, freeform} × {fact, topical}` after topical and freeform). This change widens it to a `3 × 2 × 2 = 12`-cell cube with **all cells active**:

```
                       text                    image
fact + boolean      │ EXISTING               │ NEW visual+fact+bool        │
fact + choice       │ EXISTING               │ NEW visual+fact+choice      │
fact + freeform     │ FREEFORM PROPOSAL      │ NEW visual+fact+freeform    │
topical + boolean   │ TOPICAL PROPOSAL       │ NEW visual+topical+bool     │
topical + choice    │ TOPICAL PROPOSAL       │ NEW visual+topical+choice   │
topical + freeform  │ FREEFORM × TOPICAL     │ NEW visual+topical+freeform │
```

The six new image-medium paths share a common `VISUAL_RESEARCH_SUBFLOW` constant (analogous to the existing `QUESTION_FLOW_STEPS` / `CHOICE_FLOW_STEPS` / `FREEFORM_FACT_FLOW_STEPS` helpers in `scheduledPrompts.ts`) for the *subject-discovery* half. They diverge for the *statement-writing* half based on `answersFormat`.

**Shared subflow — subject discovery (all 6 visual paths):**

1. Pick a category from `categories.ideas` (drawn from the standard category pool — same source for image and text medium).
2. Brainstorm 3–5 candidate subjects in that category. For `topical` variants: ground them in a recent event found via WebSearch (this is the topical bit).
3. **Pick an image-search tool.** Scan the available tools for names containing `image_search`. Match the category against each tool's description (e.g., for "Movies" prefer `mcp__tmdb_image_search__find_movie`; for "Flags" prefer `mcp__commons_image_search__find_subject`; for niche subjects with no specialized source, fall back to `mcp__brave_image_search__find_image`). If NO `*_image_search__*` tool is available, ABORT the visual path and re-roll `get_ideas` (graceful fallback to text — see Decision 5 and the no-image-tool fallback in this design).
4. Call the chosen tool with `query: <candidate subject>`. The tool returns a multimodal result: image content block + text metadata block (see Decision 5).
5. **Inspect the image** (see Decision 8.5 for the four checks). If subject mismatch / unclear / leaks the answer → try a different query on the same tool, OR switch to another available image-search tool, OR return to step 2 with a different candidate.
6. Parse the metadata block, read `subjectId`. Call `find_previous_subjects({ subjectId })`. If hit, return to step 2.
7. Note the distinguishing visual features observed during inspection — these inform distractor choice (for choice template) or confusable identification (for boolean claim template).

**Diverged step — statement writing:**

- **Choice variants (visual+\*+choice):** Write the identification prompt ("Who is this?", "What animal?", etc.) and place the correct option (the subject's title) at `suggestedCorrectIndex`. Write (N-1) plausible distractors — same-category siblings (e.g., for a flag, similar-looking flags from other countries). Run the choice path's distractor plausibility gate.
- **Boolean variants (visual+\*+boolean):** Write a *claim-based* statement asserting an identity or property about the image. Branch on the rolled `suggestedAnswer`:
  - **TRUE polarity:** State the correct identity/property ("This is the flag of Ecuador.", "This species is the cheetah.").
  - **FALSE polarity:** State a plausible-but-wrong claim. The strongest false claims swap to a *confusable* subject (Ecuador's flag → "This is the flag of Colombia.", cheetah → "This species is the leopard.") rather than a random wrong identity. The visual research subflow can return confusable siblings as a hint, or Claude identifies them via the category context. Run the boolean path's polarity self-check gate.
- **Freeform variants (visual+\*+freeform):** Write the identification prompt ("Who is this?", "What animal is this?", "Which landmark is shown?"). Set `expectedAnswer` to the subject's title from the image-search tool's metadata block. Optionally populate `acceptableAnswers` with observed variants — alternate names from the image inspection step, common transliterations, etc. Optionally populate `gradingNotes` when a category-level acceptance pattern is needed ("Accept any spelling that clearly identifies this species"). No polarity gate, no plausibility gate.

**Shared closing — all three variants:**

8. Run the difficulty gate (same as everywhere).
9. Save via `save_question` with `promptMedium: "image"`, `media: { url, altText, subjectId, title, license?, attribution? }` (sourced from the metadata block; `url` is always the `imageUrl` field), the `answersFormat`-appropriate fields (`isTrue` / `choices`+`correctIndex` / `expectedAnswer`+optional `acceptableAnswers`+optional `gradingNotes`), and (for topical variants) `sourceUrl` + `eventDate`.

The six new paths differ only in step 2 (whether WebSearch is used to ground the subject in a recent event) and the diverged statement-writing step (which template + which gates). Sharing the research subflow keeps the prompt auditable without duplicating the gates.

**Why not unify all 12 paths through one mega-template?** Same reasoning the topical and freeform proposals applied: explicit paths are auditable, the gates are agnostic to the source, and DRY-ing prompt orchestration trades readability for clever indirection. The visual paths *do* share their subject-discovery subflow as a named constant — that's the natural seam.

**Dedup nuance per template:**

- `image+choice`: statement is templated ("Who is this?"); statement-text `find_previous_questions` would always match — skip it. Use `find_previous_subjects` only.
- `image+boolean`: statement is variable (the claim text). Use BOTH `find_previous_subjects` AND `find_previous_questions` against the claim text (the "required dual-check" from the question-posting spec).
- `image+freeform`: statement is templated ("Who is this?"). Same as choice — `find_previous_subjects` only; do NOT call `find_previous_questions`.

## Risks / Trade-offs

- **[Risk] Upstream image URL changes between save and post.** A question saved with `media.url = X` might find X 404 at post time (Wikipedia main image changes, CDN reorgs, generic web pages get edited). → **Mitigation**: Decision 4 (mandatory Slack re-upload at post time) makes this a non-issue once posted — the asset lives on Slack's CDN. Between `save_question` and `post_questions`, the window is short (same scheduled-run typically); if the upstream URL 404s in that window, the file-upload hop fails and `post_questions` returns an error for that item, which the existing per-item error handling surfaces. Per-plugin reliability concerns (rate limits, retry-with-backoff, source-specific quirks) live in each image-search plugin, not in trivia.

- **[Risk] Visual questions are inherently more cheatable than text.** Reverse image search is one tap on mobile. → **Mitigation**: Existing cheat-detection machinery applies (the bot can't tell the difference between someone Googling text and someone reverse-image-searching). Acknowledge the elevated cheatability and consider weighting visual rounds lower in leaderboard scoring if real abuse surfaces (out of scope for v1).

- **[Risk] Attribution string contains the subject name and would leak on reveal preview.** Slack reveal messages are in the same thread as the question, so a notification preview of the reveal won't be seen by users who haven't already seen the question. But cross-channel link unfurls of the reveal *could* leak. → **Mitigation**: Acceptable for v1 (reveals are intra-thread and unfurls are rare). If real abuse surfaces, strip subject name from attribution before rendering.

- **[Risk] Cross-source dedup misses (same subject, different image-search plugins).** A movie saved with `tmdb:m-550` later appearing with `wikidata:Q172241` won't be detected as a duplicate by `find_previous_subjects`. → **Mitigation**: Documented as accepted (Decision 5). In practice, most categories naturally route to one preferred image-search tool (Claude reads tool descriptions and picks), so cross-source duplicates are rare. The image-inspection gate provides a secondary signal — Claude often recognizes "this is Fight Club again" from the image content even when subjectIds differ.

- **[Risk] No image-search plugin installed.** Admin enables `promptMedium.image > 0` but has not installed any `*_image_search__*` plugin. → **Mitigation**: The visual research subflow's step 3 detects an empty image-search-tool list and aborts the visual path immediately, re-rolling `get_ideas` (which usually yields a text-medium question). No errors surface to end users. Document the install requirement in the admin docs ("install at least one image-search plugin to enable visual rounds").

- **[Risk] Claude picks the wrong image-search tool for a category.** With multiple plugins installed, Claude might call `mcp__brave_image_search__*` for "Animals" when `mcp__inaturalist_image_search__*` would have been better. → **Mitigation**: Tool descriptions guide selection — plugin authors are responsible for writing precise descriptions ("iNaturalist species photos, research-grade only" vs "generic web image search"). The image-inspection gate catches bad picks: if Brave returns a stylized illustration when iNat would have given a clean photograph, Claude can re-roll with a different tool. Worst case is a slightly weaker visual question, not a broken one.

- **[Trade-off] Larger prompt surface area.** Six new paths beyond the existing six. The visual paths share a subflow but the prompt still grows ~30% over the post-freeform baseline. → **Accepted**: Auditability of explicit paths outweighs DRY for now.

- **[Trade-off] Visual variety depends on which plugins are installed.** Admin who only installs `commons-image-search` has thin coverage for movies, TV, games, anime. → **Accepted**: this is the design point — each source is its own opt-in plugin with its own keys and rate-limit story. The admin's install choices determine the visual palette. Documented as "v1 ships with the contract; quality scales with how many plugins you install."

- **[Trade-off] No audio/video v1.** Reserved as future `promptMedium` values. → **Accepted**: image alone is a substantial scope and audio/video have separate file-upload, attribution, and dedup considerations.

- **[Trade-off] Image and text share one category pool.** An image roll can land on a non-visual category and burn part of the research-subflow retry budget before falling back to text. → **Accepted** (Decision 3): the wasted re-rolls are cheaper than maintaining a parallel `visualCategories.json` that drifts from what installed image-search plugins can actually serve.

## Open Questions

- **Should the image-search tool contract require an optional `subjectId` argument for direct-lookup disambiguation?** Lets Claude resolve disambiguation upstream (e.g., "Mercury" → planet vs element vs god). Default decision: no for v1 — `query` is sufficient; per-plugin proposals can add optional ID lookup args without breaking the contract.

- **Does the reveal-flow attribution block belong on `process_reveal_answers` payload or rendered by the prompt?** Current plan: payload exposes `media.attribution` and `media.license`; prompt renders the context block. Alternative: payload pre-renders the attribution string. Default: keep payload data-shaped, prompt does rendering — same convention as everywhere else in the trivia plugin.

- **Should questions with `media` be excluded from the cumulative leaderboard?** If visual rounds are markedly more cheatable, including them in the same scoreboard might be unfair. Default decision: include them — same scoreboard, no special treatment for v1. Revisit if cheat-attempt rates spike on visual questions specifically.
