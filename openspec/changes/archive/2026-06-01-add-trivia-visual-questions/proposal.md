## Why

The trivia plugin generates only text-prompted questions today. There is no way to ask "who is this?", "what landmark is this?", "what anime character is this?", "which album cover?", "from what video game?", or "what species is this?". A visual round — where the prompt is an image and the user picks from text choices (or types the answer freeform) — is a natural extension that doesn't require new answer-shape machinery (it reuses `choice`/`freeform` scoring) but does introduce a third orthogonal axis: the medium the prompt is delivered in.

`add-trivia-topical-questions` already factored the old single `type` field into two orthogonal axes (`answersFormat`, `questionType`) and established the cascade pattern for adding more. This change adds a third axis (`promptMedium`) using the same pattern. The combination matters: a photo of a recent newsworthy event is *both topical and visual*, and modeling visual as a value of `questionType` (`"visual"` alongside `"fact"`/`"topical"`) would forbid that combo. Treating it as an orthogonal axis preserves it.

**Image sourcing is decoupled from trivia.** Trivia does not embed image-source code, does not maintain a registry of providers, and does not know about Wikipedia, TMDB, Brave, or any other source. Image-search plugins are standalone Clack plugins that expose MCP tools matching a documented contract (multimodal return, source-namespaced `subjectId`, structured errors). Trivia's prompt instructs Claude to call any available `*_image_search__*` MCP tool that fits the category, inspect the returned image inline (multimodal — Claude sees the pixels), and proceed. Each image-search plugin ships as its own OpenSpec change with its own config, key, and rate-limit handling. Admins enable visual trivia for a given category by installing the appropriate image-search plugin(s).

A real concern unique to image-prompted questions: public image URLs leak the answer in the filename ("Eiffel_Tower.jpg" → giveaway). Slack's link unfurl and hover preview expose the URL even when the rendered card looks clean. This change mandates re-hosting images via Slack's `files.uploadV2` with a neutral filename so the asset is anonymous.

## What Changes

- **New axis — `promptMedium: { text: N, image: N }`** (default `{ text: 1, image: 0 }`). Cascades `slot → season → config → default` like `answersFormat` and `questionType`. Independent weighted roll in `get_ideas`.
- **New optional field — `TriviaQuestion.media`** — present iff `promptMedium === "image"`. Holds `{ kind: "image", url, altText, subjectId, title, license?, attribution?, slackFileId? }`.
- **`get_ideas` returns `suggestedPromptMedium`** as a third server-rolled axis. All 12 combinations of `image × {boolean, choice, freeform} × {fact, topical}` are permitted. Image+boolean uses a *claim-based* template ("This is the flag of Ecuador. T/F"). Image+choice uses an *identification* template ("What is this?" + N candidate names). Image+freeform uses a *typed-identification* template ("Who is this?" + text input).
- **Categories are medium-agnostic — no separate visual pool.** Image-medium questions draw from the same `categories.json` pool (and the same season/slot cascade) as text-medium questions. When an image roll lands on a category with no good visual subject, the prompt's research subflow re-rolls within its budget and falls back to text — there is no `get_ideas`-side visual pool or empty-pool fallback. (See design.md Decision 3 for why a separate `visualCategories.json` was rejected.)
- **External image-search tool contract.** Trivia's prompt looks for any MCP tool whose name contains `image_search` (e.g., `mcp__brave_image_search__find_image`, `mcp__commons_image_search__find_subject`, `mcp__tmdb_image_search__find_movie`). Each such tool MUST:
  - Accept at minimum a free-form `query` string (and MAY accept a `category` argument for category-aware sources).
  - Return a **multimodal tool result**: one image content block (the actual image bytes Claude can see) PLUS one text content block carrying `{ source, subjectId, title, imageUrl, license?, attribution? }`.
  - Use a source-namespaced `subjectId` (e.g., `brave:<hash>`, `tmdb:m-<id>`, `commons:File:...`, `wikidata:Q<n>`) so trivia's `find_previous_subjects` dedup works without normalization across sources.
  - Return structured errors (`notFound`, `rateLimit`, `network`, `tooLarge`, `unsupportedFormat`, `unknown`, `keyMissing`) so Claude can retry/fall through cleanly.
  
  Image-search plugins (Brave, Commons, TMDB, Jikan, iNaturalist, etc.) are **separate OpenSpec proposals**, each landing independently. This change does NOT include any image-search code — only the contract.
- **Image-inspection step (Claude-side).** Because the tool result is multimodal, Claude SHALL inspect the inline image before writing the question. Four checks: subject match (does the image depict what the metadata claims?), subject clarity (clearly visible? no obstruction?), answer leakage (no text overlays, captions, watermarks, or labels revealing the answer?), and distinguishing features (what's visually evident — informs distractor choice and identity-swap selection). Failures trigger a re-roll (call a different tool, or call the same tool with a different query). The inspection runs inside the question-generation prompt — trivia does not implement any image-content validation server-side.
- **Graceful fallback when no image source available.** When Claude's available tool list contains no `*_image_search__*` tool — or every such tool returns `notFound`/`keyMissing`/all-other-errors after the retry budget — the prompt SHALL re-roll the question as text-medium. No errors surface to users. This is the "no image provider installed → text question" path.
- **New MCP tool — `find_previous_subjects({ subjectId })`** — searches saved questions by `media.subjectId` for subject-level dedup. Statement-text dedup via `find_previous_questions` is useless for templated visual prompts ("Who is this?"); subject-level dedup is the right key. This tool stays inside trivia because it queries trivia's own data.
- **Slack file-upload hop in `post_questions`** — when a question's `media.url` is an external URL and `media.slackFileId` is unset, `post_questions` downloads the upstream image and re-uploads via `files.uploadV2` with a neutral filename (`trivia-q-<questionId>.<ext>`), stamps `media.slackFileId` on the record, and references the Slack-hosted file in the rendered `hero_image`. Prevents URL/filename leak in Slack previews and unfurls.
- **`save_question` accepts new fields**: `promptMedium` (optional, validated against active weights), `media` (required when `promptMedium === "image"`, forbidden otherwise). No cross-axis restrictions on `answersFormat` × `promptMedium` — all six combos with image medium save.
- **Six new prompt paths** in `SEND_QUESTIONS_INSTRUCTIONS` (covering `image × {boolean, choice, freeform} × {fact, topical}`): `visual+fact+choice`, `visual+fact+boolean`, `visual+fact+freeform`, `visual+topical+choice`, `visual+topical+boolean`, `visual+topical+freeform`. All share a common `VISUAL_RESEARCH_SUBFLOW` ("pick a category-appropriate `*_image_search__*` tool from the available list → call it with a hint → inspect the inline image → call `find_previous_subjects` for dedup → re-roll on failure"). After research, they split on `answersFormat`:
  - **Choice paths** write an identification prompt + N candidate names (subject's title at `suggestedCorrectIndex`, N-1 same-category-sibling distractors).
  - **Boolean paths** write a *claim-based* statement asserting identity/property about the image (distractor in the claim — identity-swap to a confusable subject, or image-grounded property claim for unique subjects).
  - **Freeform paths** write an identification prompt + typed text input — `expectedAnswer` is the subject's title from the image-search tool's result; `acceptableAnswers` optionally enumerates observed variants. No options to leak hints, no T/F polarity — the cleanest expression of "image IS the question."
  
  Topical variants additionally run WebSearch to anchor the subject in a recent event before searching for its image and save both `media` AND `sourceUrl`.
- **Governing principle: the image IS the question** (enforced in the prompt, not at storage). For image-medium questions to be valid, removing the image must break the question. A claim like "Birds have hollow bones. T/F" stays true regardless of which bird is shown — that's a text question with a decorative photo, not a visual question. Valid claims are about *this specific subject in this specific image*: identity ("This is the flag of Ecuador"), or properties that require identifying the subject first ("This bird is native to Europe" + Cardinal photo).
- **Reveal flow surfaces image attribution** — when a revealed question has `media`, the reveal includes a small "📷 Image: <attribution> · <license>" line. Honors source license terms (CC-BY-SA typically requires attribution; "unknown"-license sources surface the upstream domain).
- **No migration.** `promptMedium` and `media` are optional, additive fields. Legacy records without `promptMedium` are read as `"text"` at every site. No rename, no stamping, no boot blocker.

## Capabilities

### New Capabilities

- `trivia-visual-questions`: the `promptMedium` axis (data, config cascade, server-rolled suggestion), the `media` field shape on `TriviaQuestion`, the external image-search tool contract (documented for plugin authors), the `find_previous_subjects` tool, the Slack file-upload hop, the visual-research prompt subflow, the image-inspection gate, and the graceful no-image-tool fallback.

### Modified Capabilities

- `trivia-question-search`: extends `save_question` validation to recognize `promptMedium` and `media`; introduces `find_previous_subjects` for subject-level dedup.
- `trivia-question-posting`: per-question/per-slot generation now dispatches on a 3-axis matrix `(answersFormat × questionType × promptMedium)`. `post_questions` performs the Slack file-upload hop and renders `hero_image` for image-medium questions. The reveal flow surfaces image attribution when present.
- `trivia-seasons`: `SeasonEntry` and `SeasonFormatSlot` gain optional `promptMedium` cascade fields alongside the existing `answersFormat` / `questionType` / `contexts`. `upsert_season` accepts them with the same mid-season-mutation semantics.

## Impact

- **Stored data**: no migration. New question records optionally carry `promptMedium` and `media`. Legacy records without `promptMedium` are read as `"text"`. No new data files — image-medium questions reuse the existing `categories.json` pool.
- **Code (this proposal only)**: `src/plugins/trivia/core/types.ts`, `src/plugins/trivia/core/dataLayer.ts`, `src/plugins/trivia/domain/promptMediums.ts` (NEW sibling to `questionTypes.ts`), `src/plugins/trivia/tools/questions/getIdeas.ts`, `src/plugins/trivia/tools/questions/saveQuestion.ts`, `src/plugins/trivia/tools/questions/postQuestions.ts`, `src/plugins/trivia/prompts/scheduledPrompts.ts`. New `src/plugins/trivia/tools/visual/findPreviousSubjects.ts`. **No `visualSources/` directory — image-search code lives in separate plugins. No category-tool changes — `add_categories` / `remove_categories` are untouched.**
- **External dependencies**: none added by this proposal. Slack `files.uploadV2` is already used elsewhere (see `src/slack/handlers/homeTab.ts:877`); no new auth scope expected. Visual rounds remain functionally invisible until an image-search plugin is installed.
- **Configuration**: no breaking changes. Existing `config.json` files load unchanged. Admins opt into visual rounds by (1) setting `promptMedium.image > 0` at any cascade tier, AND (2) installing at least one image-search plugin.
- **Tests**: full coverage for the cross-axis validation in `save_question`, the file-upload hop in `post_questions`, the prompt branching, the attribution rendering in reveal, and the "no image-search tool installed → text fallback" path.
- **User-visible behavior**: zero change when no game enables `promptMedium.image > 0` OR no image-search plugin is installed. With both enabled, occasional image-prompt questions in the trivia channel, with attribution shown on reveal.

## Dependencies

This change **depends on `add-trivia-topical-questions` and `add-trivia-freeform-questions` having shipped first** (both have at the time of writing):

- From topical: uses the `answersFormat` field name (renamed from `type`), the `questionType` axis (`fact | topical`), the `sourceUrl` / `eventDate` semantics (inherited on `visual+topical` records), and the `contexts` cascade slot.
- From freeform: uses the `answersFormat: "freeform"` value (a third answer-format on top of boolean/choice), the `expectedAnswer` / `acceptableAnswers` / `gradingNotes` fields on `TriviaQuestion`, the `[Answer]` button injection in `post_questions`, the `deriveReactions: []` behavior for freeform, the `answerText` field on `SubmittedAnswer`, and the reveal-time Haiku judge.
- Extends the same orthogonal-axes cascade pattern (`slot → season → config → default`) that both proposals established — `promptMedium` is the third axis using the identical cascade machinery.

**This change does NOT depend on any image-search plugin shipping.** Visual rounds activate only when both this proposal AND at least one image-search plugin are deployed. The two can land in any order, though there's no observable visual behavior without both.

## Related (not dependencies — separate proposals)

Each image-search source lands as its own OpenSpec change. Likely first candidates:

- `add-brave-image-search-plugin` — generic web image search (free key, ≈2000 queries/month). Long-tail fallback.
- `add-commons-image-search-plugin` — Wikipedia/Wikimedia Commons. Keyless. Strong for people, landmarks, flags, paintings, history.
- `add-tmdb-image-search-plugin` — TMDB (movies, TV series, actors). Free key.
- `add-jikan-image-search-plugin` — Jikan/MyAnimeList (anime, manga characters). Keyless.
- `add-inaturalist-image-search-plugin` — iNaturalist (species, plants, birds). Free key, research-grade.
- `add-cover-art-archive-image-search-plugin` — MusicBrainz + Cover Art Archive (album covers). Keyless.
- `add-nasa-image-search-plugin` — NASA Images (space, astronomy). Keyless.
- `add-open-library-image-search-plugin` — Open Library (book covers). Keyless.
- `add-met-open-access-image-search-plugin` — The Met Open Access (paintings, sculpture, art history). Keyless.
- `add-rawg-image-search-plugin` — RAWG (video games). Free key.

Order and selection are admin/community choices. Each plugin proposal stands alone with its own design, tasks, and specs.
