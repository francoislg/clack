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
- Support both image templates: identification (image+choice) and claim-based (image+boolean). All 8 axis combinations are permitted.
- Source images from a **pluggable registry of free image APIs**, with the right source picked per category. Ship v1 with broad coverage: Wikipedia/Commons (people, landmarks, flags, history, paintings), Openverse (general CC fallback), Cover Art Archive (albums), Jikan (anime/manga), Open Library (books), NASA (space), Met OA (paintings). Free-key opt-ins: iNaturalist (species), TMDB (movies/TV), RAWG (video games).
- Mandate Slack file re-hosting before posting to prevent URL/filename leak.
- Provide subject-level dedup (`find_previous_subjects`) since statement-level dedup is useless for templated visual prompts.
- Surface attribution in the reveal to honor Wikimedia license terms.
- Keep zero-configuration behavior identical to post-topical: a deployment that doesn't set `promptMedium.image > 0` generates the same questions it does today.
- No migration. Additive, optional fields only.

**Non-Goals:**

- **Brand logos** and **comics panels/covers**. Logos hit a wall on every free source (copyright; no CC-licensed canonical version). Comics covers/panels: ComicVine has unclear licensing, Marvel API is Marvel-only with non-commercial restrictions, no clean DC source. Reserve for a future change if real demand surfaces.
- **Topical event photos** (the actual news event, not a stock photo of the subject). News photos are copyright-locked and indexing-lagged on all free sources. Visual+topical questions use canonical subject images (e.g., a leader's portrait) grounded by WebSearch-discovered events.
- Free-form numeric / range answers ("When was this photo taken? <year input>"). Choice-only for v1; year buckets work fine as multi-choice.
- Audio or video prompts. Reserved as future values of `promptMedium`; this change ships `text | image` only.
- Per-`questionType` `promptMedium` weights (e.g., "only allow image on topical"). Out of scope; weights are flat at each cascade tier, and the natural roll-and-constrain mechanic handles the validity matrix.
- Cheating mitigations specific to reverse-image-search. Visual questions are inherently more cheatable than text; the existing cheat-detection machinery remains the only line of defense for v1.
- Server-side image-content validation. We trust the upstream (Wikipedia main image for the requested subject) and accept that an occasional miscategorized image will slip through.

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
- **image+freeform → typed-identification template.** "Who is this?" / "What animal is this?" / "Which landmark is shown?" + text input. Probably the strongest visual shape: no multi-choice options to leak hints, no T/F polarity to game. `expectedAnswer` is the subject's title from `find_visual_subject.result.title`. `acceptableAnswers` can be populated with observed variants when applicable (e.g., "Eiffel Tower" / "La Tour Eiffel" / "tower of Eiffel"; "Mount Everest" / "Sagarmatha" / "Chomolungma"). The reveal-time Haiku judge handles spelling forgiveness, alternate forms, and the multi-guess rejection rule (e.g., "Eiffel Tower or Big Ben" is rejected with `multiple-guess`).

For image+boolean, the existing boolean-flow polarity gate still applies: when `suggestedAnswer === false`, the statement asserts a plausible-but-wrong claim about the image (identity swap or image-grounded property). When `suggestedAnswer === true`, the statement asserts a correct identification or image-grounded property.

For image+freeform, no polarity gate applies (freeform has no suggested answer to roll). The plausibility gate also doesn't apply (no distractors to score). The image-is-question gate (Decision 2 principle) is the only quality bar besides the difficulty gate.

**Why no cross-axis constraint?** Initial design forbade image+boolean on the assumption that "Is this X?" degenerates to a no-trap question. That's wrong for confusable subjects — recognizing a country's flag vs. its lookalike is a real recall test, harder than choice (where the wrong options are visible to recognize) because the user must hold the correct flag in memory and compare. Hard-forbidding the combo would foreclose a meaningfully different game shape.

**Implication for `get_ideas` and `save_question`.** Both axes roll independently with no constraints between them. No server-side re-roll. No save-time cross-axis rejection. The only validation that touches `media` is "present iff `promptMedium === image`" (covered in Decision 1's record shape). The "image IS the question" principle is enforced *in the prompt* — at the question-writing gates, not at storage — because it's a content-quality rule that requires reading the statement against the image, which only Claude can do.

### Decision 3: Visual category pool as a parallel flat list, not annotated categories

A new optional file `data/plugins/trivia/visualCategories.json` holds a flat `string[]` — sibling pool to the existing `categories.json`. When `suggestedPromptMedium === "image"`, `get_ideas` draws from the visual pool instead of the general one.

**Why a parallel list rather than annotating categories with `{ name, visualEligible }`?** The topical proposal made the explicit decision that "categories stay flat (`string[]`)" to avoid per-category metadata. A parallel list honors that decision literally — visual eligibility lives in a separate pool, not as an annotation on individual category records. Admins manage it via the same `add_categories`/`remove_categories` tools with a new `pool` argument (mirroring the existing season `target` argument).

**Why not let Claude judge category-vs-medium fit on the fly?** Some categories are fundamentally non-visual (Cryptography, Philosophy, Mathematics, Languages). Sending Claude into a visual round in those categories produces awkward questions or expensive re-rolls. Pre-curating the visual pool is cheap, controllable, and lets admins shape the visual-round flavor without prompt engineering.

**Empty pool fallback.** When `promptMedium.image > 0` is configured but the visual pool is empty/missing, `get_ideas` re-rolls `suggestedPromptMedium` to `"text"` server-side. Same shape as the topical proposal's empty-context terminator. The configuration is technically valid (no error) but the visual roll never lands; admins see this in telemetry if they're watching.

**Alternative considered:** Hard error on `promptMedium.image > 0` with empty visual pool. Rejected — the fallback is more graceful and the empty-pool state is a transient configuration step (admin enables the axis before populating the pool), not a bug.

### Decision 4: Mandatory Slack file re-hosting via `files.uploadV2`

Before posting a question with `media`, `post_questions` SHALL download the upstream image and re-upload it via `files.uploadV2` with a neutral filename (`trivia-q-<questionId>.<ext>`). The re-uploaded file's permalink (or Slack file reference) is stored on the record as `media.slackFileId` and used in the rendered `hero_image`.

**Why mandatory?** Slack's link unfurl and hover preview expose image URLs even when the rendered card looks clean. A Commons URL like `.../Eiffel_Tower.jpg` is a giveaway — the answer is in the URL. Re-hosting strips the filename. This isn't a v2 polish; without it, half of visual questions are degenerate.

**Why not use a proxy URL endpoint?** Would add infrastructure (a route, a route handler, an image cache or pass-through). Slack file upload is one HTTP call against an API the bot already uses, and the asset is then served by Slack's CDN with all the cache/preview infrastructure for free.

**Idempotency.** When `media.slackFileId` is already set (e.g., on a re-post / replay), `post_questions` skips the upload and reuses the existing file reference. Same shape as the existing `postedAt` idempotent-skip logic.

**The card-injection seam.** The prompt does NOT build the `hero_image` block. The card it constructs has only `title`, `body`, and optional `subtitle` — no `hero_image`, no upstream URL. After uploading the image and stamping `media.slackFileId`, `post_questions` injects `hero_image: { type: "image", image_url: <slack-hosted-url>, alt_text: <question.media.altText> }` into the card. This keeps the prompt unaware of Slack URLs entirely — no sentinel strings, no URL rewriting, no synchronization between prompt-built cards and tool-rewritten cards. The prompt knows about `media` only to the extent of writing the question's statement; the card mutation is `post_questions`'s sole responsibility.

**Which Slack URL goes in `image_url`?** `files.uploadV2` returns multiple URLs (`url_private`, `permalink`, `permalink_public`). `image_url` in Block Kit requires a URL Slack can render inline for everyone in the channel. Implementation should use the response's `permalink` (workspace-internal share link, works for all channel members without making the file public) and fall back to a `slack_file: { id: <file_id> }` reference if `permalink` doesn't render cleanly in a `hero_image` block. The choice is implementation-level; the contract on `media.slackFileId` storage is just "whatever post_questions needs to re-render the card without re-uploading."

**License compatibility.** Wikimedia Commons content is overwhelmingly CC-BY-SA. Slack file uploads are private to the workspace — this is a re-distribution to a closed audience, with attribution shown on reveal, which satisfies CC-BY-SA terms in practice. Not legal advice; admins enabling visual rounds tacitly accept that posture, same as for any other UGC re-share.

### Decision 5: Pluggable source registry with category-routed adapters and source-namespaced subjectIds

`find_visual_subject({ category, hint? })` is NOT a Wikipedia client. It is a router over a registry of source adapters. Each adapter implements a small interface:

```typescript
interface SourceAdapter {
  name: string;                              // "commons" | "tmdb" | "inaturalist" | ...
  categories: string[] | "*";                // categories this source handles, or "*" for general
  requiresKey: boolean;
  keyConfigPath?: string;                    // dot-path into config where the key lives
  isAvailable(): boolean;                    // false when requiresKey && key is unset
  find(args: { category, hint? }): Promise<
    | { ok: true, result: SubjectResult }
    | { ok: false, error: SourceError }
  >;
}

interface SubjectResult {
  source: string;                            // adapter name, echoed
  subjectId: string;                         // source-namespaced: "tmdb:m-550", "wikidata:Q243", "inaturalist:46327", ...
  title: string;
  imageUrl: string;
  imageBytes: Uint8Array;                    // downloaded by the adapter, capped at 5MB
  imageMimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  license?: string;
  attribution?: string;
  summary?: string;
}
```

The router resolves which adapter(s) to call:

1. Read the registry. Compute the active set = `{ adapter | adapter.isAvailable() }`.
2. Filter to adapters that handle `category` (either explicit in `adapter.categories` or `"*"`).
3. Try in priority order. First adapter that returns `ok: true` wins. On error, fall through to the next adapter.
4. If every applicable adapter fails (or none exist for the category), return a structured error so the prompt can re-roll.

**v1 default registry:**

| Source              | Categories                                      | Key       | Priority hint |
|---------------------|-------------------------------------------------|-----------|---------------|
| `commons`           | `*` (general fallback)                          | keyless   | 50 (low)      |
| `openverse`         | `*` (broader CC aggregator over Commons+Flickr) | keyless   | 40            |
| `cover_art_archive` | `["Album Covers", "Music Albums"]`              | keyless   | 90            |
| `jikan`             | `["Anime", "Manga Characters"]`                 | keyless   | 90            |
| `open_library`      | `["Book Covers"]`                               | keyless   | 90            |
| `nasa`              | `["Space", "Astronomy"]`                        | keyless   | 90            |
| `met`               | `["Paintings", "Sculpture", "Art History"]`     | keyless   | 80            |
| `inaturalist`       | `["Animals", "Plants", "Insects", "Birds"]`    | free key  | 95 when available |
| `tmdb`              | `["Movies", "TV Series", "Actors"]`            | free key  | 95 when available |
| `rawg`              | `["Video Games"]`                               | free key  | 95 when available |

Higher priority wins ties. Admins can override priority and category mapping in `config.trivia.visualSources`.

**subjectId is source-namespaced.** Examples:

- `commons:File:Eiffel_Tower_at_night.jpg`
- `wikidata:Q243` (preferred when a Commons subject also has a Wikidata QID — the Commons adapter returns this form)
- `tmdb:m-550` (movie), `tmdb:tv-1399` (series), `tmdb:p-287` (person)
- `inaturalist:46327`
- `mbid:550e8400-e29b-41d4-a716-446655440000` (Cover Art Archive uses MusicBrainz UUIDs)
- `jikan:1` (Cowboy Bebop), `jikan:c-1` for characters
- `openlibrary:OL45883W` (work), `openlibrary:OL27448M` (edition)
- `nasa:PIA12345`
- `met:436532`
- `openverse:abc123` (last-resort identifier when no source-native ID is meaningful)

**Cross-source dedup is per-namespace.** `tmdb:m-550` and `wikidata:Q172241` may refer to the same movie (Fight Club) but `find_previous_subjects` treats them as distinct keys. We accept this as a rare-event tradeoff:

- Most categories will route to one preferred source (e.g., "Movies" → TMDB), so cross-source duplicates are unusual.
- A cross-source mapping table is expensive to build and maintain.
- Page renames / ID drift between source ecosystems make automated mapping unreliable.
- If the same subject appears twice from different sources in practice, it's a question quality issue, not a correctness bug — the second appearance is a near-duplicate the player might still find interesting.

**Why a registry instead of one tool per source?** Two reasons:

1. **Prompt simplicity.** Claude sees one tool with one contract. The "which source for which category" routing is server-side configuration, not prompt logic. Without this, the prompt explodes in size to teach Claude when to call `find_movie_subject` vs `find_animal_subject` vs `find_album_subject`.
2. **Extensibility.** Adding a new source is a config change (register an adapter) — no spec/prompt churn. A future `add-trivia-comics` proposal that ships a ComicVine adapter just registers itself in the registry.

**Wikipedia thumbnail.source vs originalimage.source.** The Commons adapter SHALL always prefer `thumbnail.source` (a rasterized PNG/JPEG at a reasonable size) over `originalimage.source` (which is often an SVG master for flags/coats-of-arms/diagrams). This single line fixes the flag-trivia use case — Ecuador's flag thumbnail is a clean PNG, even though the canonical master is an SVG.

**Why not Pexels/Unsplash/Pixabay?** They return generic stock photos that look pretty but aren't *subject-canonical*. A search for "capybara" on Unsplash returns a beautifully-shot capybara photo by a hobbyist photographer — but no guarantee that's *the* representative image of the species. For trivia, we want canonical (the Wikipedia/iNat photo of THE capybara as a species), not aesthetic (any capybara). Stock-photo sources are explicitly excluded.

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

A new `find_previous_subjects({ subjectId })` MCP tool searches saved questions by `media.subjectId`. The visual-path prompt calls this immediately after `find_visual_subject` to check whether the chosen subject has been asked about before. If hit, re-roll.

**Why a dedicated tool rather than extending `find_previous_questions`?** Two reasons:

1. **Semantic clarity.** `find_previous_questions` searches text. The dedup signal for visual is structurally different — it's a key match, not a substring search. Mixing them muddles the tool's contract.
2. **Performance.** Filtering by `media.subjectId === X` is an exact match on an indexable field; the in-memory loop is cheap. A future move to a real index doesn't require changing the tool's shape.

**What about same-image dedup (different subjects, same Commons file)?** Rare but possible (one Commons image used as the canonical illustration for two related Wikidata items). Out of scope; subject-level is the right primary key and image-level edge cases can be addressed if they actually occur.

### Decision 8: Attribution rendered in reveal, not in the question card

When a revealed question has `media`, the reveal block layout includes one extra `context` block above the closer: `"📷 Image: <attribution> · <license>"`. The question card itself stays clean — no attribution byline, because that's visual clutter at posting time and an easy place to leak hints about the subject.

**Why?** Wikimedia attribution often contains the subject name (`"Eiffel Tower at night by [photographer]"`). Showing it at posting time defeats the question. Showing it at reveal time satisfies the license requirement and adds an educational beat to the reveal ("here's where you can learn more about this subject"). Slack mobile users seeing the question card don't get attribution; users who view the reveal do.

**Trade-off:** Strict CC-BY-SA reading might argue attribution should appear *with* the work, not separately. We treat the question+reveal pair as a single editorial unit (they're posted in the same thread) and put attribution on the reveal half. If this posture proves insufficient, attribution can be moved to a small bottom-of-card context block at posting time — but only after pruning the subject name from the attribution string.

### Decision 8.5: Claude inspects the image before writing the question

`find_visual_subject` SHALL return the image bytes inline in its tool result (multimodal content), not just a URL. Claude SHALL then perform an **image inspection step** as part of the visual research subflow, BEFORE writing any statement or distractors. The inspection evaluates four things:

1. **Subject match.** Does the image actually depict what the metadata claims? (Wikipedia's "main image" is occasionally a diagram, a coat of arms, a map, or a tangentially-related photo rather than a canonical subject photo.)
2. **Subject clarity.** Is the subject clearly visible? (No heavy obstruction, multiple competing subjects, low resolution, ambiguous angle.)
3. **Answer leakage.** Does the image contain text, captions, watermarks, or labels that would reveal the answer? (E.g., a flag image with the country name in the caption baked into the JPEG; a team photo with the team name on jerseys; a museum placard.)
4. **Distinguishing features.** What's visually evident that Claude can write a claim about? (For the boolean claim template, this informs the identity-swap choice — Claude needs to know what features make the image confusable with similar subjects.)

If any of (1), (2), or (3) fail, Claude SHALL re-roll: call `find_visual_subject` with a different candidate, or move to a different subject within the category. The failure mode is silent — no error from the tool, just a re-roll, the same way the duplicate-detection step works.

**Why does this need to be a discrete step?** Without inspection, Claude is writing questions about its *expectation* of the image rather than the *actual* image. The failure mode looks like: question says "Who is this?" with 4 choices, but the Wikipedia main image for the subject is actually a coat of arms (because that's what the article uses), so the question is unanswerable from the image. Or: the false-polarity claim "This is the flag of Colombia" assumes the user sees a flag, but the article's main image is a map. Inspection catches this before the question ships.

**Why inline in the tool result, not a separate `inspect_image` tool?** Two reasons:

1. **Latency.** A separate tool call adds a round-trip with no information gain — Claude is going to inspect the image right after `find_visual_subject` returns regardless. Returning it inline collapses two tool calls into one.
2. **Coupling.** The image is part of the subject, not a separate resource. The tool result that says "here is the subject I found" should include the image that comes with it.

**Implication for the SDK mechanism.** The Claude Agent SDK supports multimodal tool results (image content blocks alongside text). `find_visual_subject` constructs a result with one image block (the downloaded bytes, MIME-typed) plus a text block carrying the structured metadata (`subjectId`, `title`, `license`, `attribution`, `summary`). The image bytes are downloaded server-side at tool-execution time, not just URL'd through — this also gives the tool an early failure signal if the upstream URL 404s (better caught here than in `post_questions`).

**What if the image is huge or in a weird format?** The tool SHALL: (a) cap downloads at a sane limit (e.g., 5 MB) — reject larger; (b) accept JPEG/PNG/WebP/GIF, reject SVG and exotic formats; (c) resize/transcode to a Slack-friendly variant if needed (the same bytes get re-uploaded by `post_questions` later, so doing it once at the source is cheap). Failure modes return a structured error so Claude can re-roll.

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

**Shared subflow — subject discovery (all 4 visual paths):**

1. Pick a category from `categories.ideas` (the visual pool, when image medium was rolled).
2. Brainstorm 3–5 candidate subjects in that category. For `topical` variants: ground them in a recent event found via WebSearch (this is the topical bit).
3. Call `find_visual_subject({ category, hint })` with the most promising candidate. The tool returns the image inline alongside the metadata (see Decision 8.5).
4. **Inspect the image** (see Decision 8.5 for the four checks). If subject mismatch / unclear / leaks the answer → return to step 2 with a different candidate.
5. Call `find_previous_subjects({ subjectId })`. If hit, return to step 2.
6. Note the distinguishing visual features observed during inspection — these inform distractor choice (for choice template) or confusable identification (for boolean claim template).

**Diverged step — statement writing:**

- **Choice variants (visual+\*+choice):** Write the identification prompt ("Who is this?", "What animal?", etc.) and place the correct option (the subject's title) at `suggestedCorrectIndex`. Write (N-1) plausible distractors — same-category siblings (e.g., for a flag, similar-looking flags from other countries). Run the choice path's distractor plausibility gate.
- **Boolean variants (visual+\*+boolean):** Write a *claim-based* statement asserting an identity or property about the image. Branch on the rolled `suggestedAnswer`:
  - **TRUE polarity:** State the correct identity/property ("This is the flag of Ecuador.", "This species is the cheetah.").
  - **FALSE polarity:** State a plausible-but-wrong claim. The strongest false claims swap to a *confusable* subject (Ecuador's flag → "This is the flag of Colombia.", cheetah → "This species is the leopard.") rather than a random wrong identity. The visual research subflow can return confusable siblings as a hint, or Claude identifies them via the category context. Run the boolean path's polarity self-check gate.
- **Freeform variants (visual+\*+freeform):** Write the identification prompt ("Who is this?", "What animal is this?", "Which landmark is shown?"). Set `expectedAnswer` to the subject's title from `find_visual_subject.result.title`. Optionally populate `acceptableAnswers` with observed variants — alternate names from the image inspection step, common transliterations from `summary`, etc. Optionally populate `gradingNotes` when a category-level acceptance pattern is needed ("Accept any spelling that clearly identifies this species"). No polarity gate, no plausibility gate.

**Shared closing — all three variants:**

5. Run the difficulty gate (same as everywhere).
6. Save via `save_question` with `promptMedium: "image"`, `media: { ... }`, the `answersFormat`-appropriate fields (`isTrue` / `choices`+`correctIndex` / `expectedAnswer`+optional `acceptableAnswers`+optional `gradingNotes`), and (for topical variants) `sourceUrl` + `eventDate`.

The six new paths differ only in step 2 (whether WebSearch is used to ground the subject in a recent event) and the diverged statement-writing step (which template + which gates). Sharing the research subflow keeps the prompt auditable without duplicating the gates.

**Why not unify all 12 paths through one mega-template?** Same reasoning the topical and freeform proposals applied: explicit paths are auditable, the gates are agnostic to the source, and DRY-ing prompt orchestration trades readability for clever indirection. The visual paths *do* share their subject-discovery subflow as a named constant — that's the natural seam.

**Dedup nuance per template:**

- `image+choice`: statement is templated ("Who is this?"); statement-text `find_previous_questions` would always match — skip it. Use `find_previous_subjects` only.
- `image+boolean`: statement is variable (the claim text). Use BOTH `find_previous_subjects` AND `find_previous_questions` against the claim text (the "required dual-check" from the question-posting spec).
- `image+freeform`: statement is templated ("Who is this?"). Same as choice — `find_previous_subjects` only; do NOT call `find_previous_questions`.

## Risks / Trade-offs

- **[Risk] Wikipedia main-image changes after save.** Wikipedia's main image for an article can change (rare). A question saved with image URL A might find URL A 404 by reveal time. → **Mitigation**: Decision 4 (mandatory Slack re-upload at post time) makes this a non-issue once posted — the asset lives on Slack's CDN. Between `save_question` and `post_questions`, the window is short (same scheduled-run); if the upstream URL 404s in that window, the file-upload hop fails and `post_questions` returns an error for that item, which the existing per-item error handling surfaces.

- **[Risk] Visual questions are inherently more cheatable than text.** Reverse image search is one tap on mobile. → **Mitigation**: Existing cheat-detection machinery applies (the bot can't tell the difference between someone Googling text and someone reverse-image-searching). Acknowledge the elevated cheatability and consider weighting visual rounds lower in leaderboard scoring if real abuse surfaces (out of scope for v1).

- **[Risk] Wikipedia/Commons rate limits during scheduled runs.** Both APIs are keyless and have generous rate limits, but a heavily-scheduled multi-game setup could approach them. → **Mitigation**: Tools include a brief delay / retry-with-backoff in the adapter (`src/plugins/trivia/core/wikimedia.ts`). If rate-limited, return a structured error that lets Claude re-roll to a different subject.

- **[Risk] Attribution string contains the subject name and would leak on reveal preview.** Slack reveal messages are in the same thread as the question, so a notification preview of the reveal won't be seen by users who haven't already seen the question. But cross-channel link unfurls of the reveal *could* leak. → **Mitigation**: Acceptable for v1 (reveals are intra-thread and unfurls are rare). If real abuse surfaces, strip subject name from attribution before rendering.

- **[Risk] Source-specific coverage gaps.** Each source has known weaknesses: Commons is thin on pop-culture (copyright), iNaturalist is species-only, TMDB lacks artistic stills, Open Library is cover-only, etc. → **Mitigation**: The category-routed registry minimizes this — the Movies category goes to TMDB (which has it covered), not Commons (which doesn't). Multi-source fallback handles the long tail (Openverse picks up CC-licensed Flickr content Commons missed). Admins control the visual category pool, so categories with zero coverage anywhere can be removed from the pool entirely.

- **[Risk] Cross-source dedup misses (same subject, different sources).** A movie saved with `tmdb:m-550` later appearing with `wikidata:Q172241` won't be detected as a duplicate by `find_previous_subjects`. → **Mitigation**: Documented as accepted (Decision 5). In practice, category routing pins most categories to one preferred source, so cross-source duplicates are rare. The image-inspection gate provides a secondary signal — Claude often recognizes "this is Fight Club again" from the image content even when subjectIds differ.

- **[Risk] API key availability.** iNaturalist, TMDB, and RAWG keys are free but require admin signup. Without them, the registry falls back to keyless sources, reducing visual variety dramatically (Movies → Commons, which is thin). → **Mitigation**: The registry hot-resolves availability. Admins see "Movies" questions become awkward (Wikipedia main image of the movie article = poster sometimes, generic still other times) and have a clear motivation to configure the optional keys. Document the visual.png-quality difference in the admin docs.

- **[Risk] `find_visual_subject` returns a misleading image.** Wikipedia main images are usually canonical, but occasionally the article's primary image is a tangential diagram or a map. → **Mitigation**: Tool returns the upstream's main image as-is; Claude can inspect the returned `summary` and re-roll if the image looks unsuitable. Quality is on Claude + the gates, not the tool.

- **[Trade-off] Larger prompt surface area.** Six paths instead of four. The two visual paths share a subflow but the prompt still grows ~30% over the post-topical baseline. → **Accepted**: Auditability of explicit paths outweighs DRY for now.

- **[Trade-off] No audio/video v1.** Reserved as future `promptMedium` values. → **Accepted**: image alone is a substantial scope and audio/video have separate file-upload, attribution, and dedup considerations.

- **[Trade-off] Visual pool is a sibling list, not a tag.** Means a category like "Animal Kingdom" can be in both pools (good) but admins manage two lists (mild overhead). → **Accepted**: matches the topical proposal's "categories stay flat" decision.

## Open Questions

- **Should the visual pool seed with sensible defaults on first read?** The general categories list seeds via `SEED_CATEGORIES` when missing. The visual pool could seed similarly (`SEED_VISUAL_CATEGORIES: ["Famous People", "Landmarks", "Animals", "Paintings", "Flags", ...]`). Default decision: yes, seed on first read of `visualCategories.json` to give admins a starting point. Confirm.

- **Should `find_visual_subject` accept a Wikidata QID directly (bypassing search)?** Lets Claude resolve disambiguation upstream. Default decision: no for v1 — `(category, hint?)` keeps the tool's contract simple. Add QID input in a follow-up if disambiguation problems surface.

- **Does the reveal-flow attribution block belong on `process_reveal_answers` payload or rendered by the prompt?** Current plan: payload exposes `media.attribution` and `media.license`; prompt renders the context block. Alternative: payload pre-renders the attribution string. Default: keep payload data-shaped, prompt does rendering — same convention as everywhere else in the trivia plugin.

- **Should questions with `media` be excluded from the cumulative leaderboard?** If visual rounds are markedly more cheatable, including them in the same scoreboard might be unfair. Default decision: include them — same scoreboard, no special treatment for v1. Revisit if cheat-attempt rates spike on visual questions specifically.

- **What happens when `promptMedium.image > 0` but no game has populated `visualCategories.json`?** Per Decision 3, server re-rolls to `text`. Should the bot also DM the admin once on detect? Default decision: no — too noisy. Surface in admin diagnostics / Home Tab if a status panel exists.
