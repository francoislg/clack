## 1. Core types and data model

- [ ] 1.1 Update `src/plugins/trivia/core/types.ts`: add `promptMedium?: "text" | "image"` to `TriviaQuestion`; add `media?: QuestionMedia` to `TriviaQuestion`; export new `QuestionMedia` interface (`kind`, `url`, `altText`, `subjectId`, `title`, `license?`, `attribution?`, `slackFileId?`)
- [ ] 1.2 Add `PromptMediumWeights = Record<"text" | "image", number>` to `core/types.ts`
- [ ] 1.3 Extend `SeasonEntry` and `SeasonFormatSlot` with optional `promptMedium?: PromptMediumWeights`
- [ ] 1.4 Document the "absent promptMedium reads as text" convention next to the field definition

## 2. Config schema

- [ ] 2.1 Update `src/config.ts` `Config` type: add `trivia.promptMedium?: Record<"text" | "image", number>` and `trivia.visualSources?: { [sourceName: string]: { enabled?: boolean, priority?: number, categories?: string[] | "*", apiKey?: string } }` for admin overrides on the source registry
- [ ] 2.2 Update config Zod validator: validate `promptMedium` (only keys `text`/`image`, non-negative weights, at least one positive); validate `visualSources` (sourceName matches a known adapter; categories non-empty when present; priority is non-negative)
- [ ] 2.3 Export `DEFAULT_PROMPT_MEDIUM_WEIGHTS = { text: 1, image: 0 }` and `DEFAULT_VISUAL_SOURCES` (the registry table from design.md Decision 5)
- [ ] 2.4 Add config-load tests for both validations: `promptMedium` (valid, all-zero rejected, unknown-key rejected, partial map accepted); `visualSources` (admin enables an opt-in source by providing apiKey; admin disables a default source; admin overrides priority; unknown sourceName rejected)

## 3. Visual category pool

- [ ] 3.1 Add `loadVisualCategories()` / `saveVisualCategories()` to `TriviaDataLayer` (and `ScopedTriviaDataLayer` if per-game; default to global like regular categories)
- [ ] 3.2 Implement reads/writes against `data/plugins/trivia/visualCategories.json`
- [ ] 3.3 Add `SEED_VISUAL_CATEGORIES` to `src/plugins/trivia/core/seedCategories.ts` (or sibling file) with a broad starter set that matches the multi-source registry: `["Famous People", "Landmarks", "Animals", "Plants", "Birds", "Insects", "Paintings", "Sculpture", "Art History", "Flags", "World Capitals", "Movies", "TV Series", "Anime", "Anime Characters", "Manga Characters", "Album Covers", "Music Albums", "Book Covers", "Video Games", "Space", "Astronomy", "Planets", "Currency", "Vehicles", "Cuisine"]`. Do NOT include brand logos or comics covers — both hit copyright walls on every free source per design.md non-goals.
- [ ] 3.4 Seed-on-first-read behavior: when the file is missing or empty, return `SEED_VISUAL_CATEGORIES` AND write the seed to disk
- [ ] 3.5 Tests for the data layer: missing file → seeded; existing file → returned as-is; round-trip add/remove

## 4. Domain: promptMedium resolution

- [ ] 4.1 Create `src/plugins/trivia/domain/promptMediums.ts` (sibling to `questionTypes.ts`)
- [ ] 4.2 Implement `resolvePromptMediums(currentSeason, slotIndex, config) → PromptMediumWeights` — cascade `slot → season → config → DEFAULT_PROMPT_MEDIUM_WEIGHTS`, same shape as `resolveQuestionTypes`
- [ ] 4.3 Tests: default fallback; config override; season override; slot override; absent cascade levels skipped correctly

## 5. get_ideas integration

- [ ] 5.1 Update `src/plugins/trivia/tools/questions/getIdeas.ts`: roll `suggestedPromptMedium` from `resolvePromptMediums()` weights via existing `weightedPick`. The roll is fully independent of `suggestedAnswersFormat` — no cross-axis constraint.
- [ ] 5.2 Visual category pool resolution: when `suggestedPromptMedium === "image"`, draw `categories.ideas` from `loadVisualCategories()` instead of the general pool
- [ ] 5.3 Empty visual pool fallback: when `suggestedPromptMedium === "image"` and the visual pool is empty, re-roll `suggestedPromptMedium` to `text` and log at debug level
- [ ] 5.4 Response shape: add `suggestedPromptMedium` to the return payload. Keep all existing fields unchanged and emit them per the rolled answersFormat regardless of promptMedium: when `suggestedAnswersFormat === "choice"`, emit `suggestedChoiceCount` and `suggestedCorrectIndex`; when `suggestedAnswersFormat === "boolean"`, emit `suggestedAnswer`. The three axes roll independently — image rolls don't change which answerFormat-specific suggestions get emitted.
- [ ] 5.5 Update `getIdeas.choice.test.ts` (or add `getIdeas.medium.test.ts`) covering: text-only config produces all-text rolls; image-only config produces all-image rolls; image+boolean combo emerges naturally; image+choice combo emerges naturally; empty visual pool falls back to text; mixed weights produce all 4 combinations with expected proportions over many rolls

## 6. save_question validation

- [ ] 6.1 Update `src/plugins/trivia/tools/questions/saveQuestion.ts`: accept `promptMedium` (optional) and `media` (optional object) as input args
- [ ] 6.2 Validate: `promptMedium === "image"` REQUIRES `media` to be set. No restriction on `answersFormat` — both boolean and choice combine freely with image medium.
- [ ] 6.3 Validate: when `media` is present, it requires `media.kind === "image"`, plus non-empty `media.url`, `media.altText`, `media.subjectId`, `media.title`. `media.url` must be HTTPS.
- [ ] 6.4 Validate: `promptMedium === "text"` (or absent) FORBIDS `media`
- [ ] 6.5 When saving, stamp `promptMedium` on the record (even when `"text"` — so new records always carry it) and `media` when present
- [ ] 6.6 Tests covering all 8 axis combinations: the 4 image-medium combos save with media; the 4 text-medium combos reject when media is passed; media validation (missing fields, wrong kind, non-HTTPS URL); media-required-when-image enforcement; round-trip of every combination

## 7. find_visual_subject MCP tool

### 7a. Visual source registry — adapter contract and router

- [ ] 7a.1 Create `src/plugins/trivia/visualSources/types.ts` defining the `SourceAdapter` interface, `SubjectResult` shape, and `SourceError` discriminated union (`{ kind: "notFound" | "rateLimit" | "network" | "tooLarge" | "unsupportedFormat" | "unknown" | "keyMissing", message }`)
- [ ] 7a.2 Create `src/plugins/trivia/visualSources/registry.ts`: `loadRegistry(config)` returns the active adapter list with priorities, applying admin overrides from `config.trivia.visualSources` on top of the default registry. Includes `routeForCategory(category): SourceAdapter[]` returning ordered candidates.
- [ ] 7a.3 Create `src/plugins/trivia/visualSources/imageBytes.ts` shared helper: `fetchImageBytes(url, opts) → { bytes, mimeType }` with 10s timeout, 5MB cap, Content-Type-driven format detection (JPEG/PNG/WebP/GIF), structured-error returns. Used by every adapter.
- [ ] 7a.4 Create `src/plugins/trivia/tools/visual/findVisualSubject.ts` — the router. Args `{ game, category, hint? }`. Logic: load registry → `routeForCategory(args.category)` → iterate, calling each adapter's `find()` until one returns ok. If all fail, return aggregated error (lists which sources were tried).
- [ ] 7a.5 **Blocking dependency check + implementation**: implement multimodal tool result construction (image content block + text content block) using the Claude Agent SDK's `tool(...)` helper. If the SDK does not support image blocks in tool results, this is a blocker that must be raised before any other task in this proposal proceeds — surface immediately. Add an `imageAndTextResult(image, text)` helper next to the existing `textResult` / `errorResult` in `src/tools/helpers.ts` and write a smoke test that round-trips an image block through the helper.
- [ ] 7a.6 Router tests: registry with 1 source / 2 sources / 3 sources; routing for category covered by no source returns aggregated error; routing where preferred source returns `kind: "notFound"` falls through to next; routing where preferred source returns `kind: "rateLimit"` falls through; all-keys-missing for a category yields `keyMissing` aggregate; priority-ordering respected.
- [ ] 7a.7 Register the tool in the plugin's MCP server; gate it to the same role tier as `get_ideas` (member+)

### 7b. Source adapters — keyless (always-on)

Each adapter implements the `SourceAdapter` interface from 7a.1. Each has its own unit-test file mocking the upstream HTTP layer.

- [ ] 7b.1 `commons.ts` — Wikipedia REST `/page/summary/<title>` + Commons API for license/attribution. Categories: `"*"` (general fallback, priority 50). Prefers `thumbnail.source` (rasterized PNG/JPEG) over `originalimage.source` (often SVG). `subjectId` is `wikidata:Q<n>` when `wikibase_item` is present, else `wikipedia:<slug>`. User-Agent header per Wikimedia etiquette; bounded retry-with-backoff on 429/503.
- [ ] 7b.2 `openverse.ts` — Openverse search API (`https://api.openverse.engineering/v1/images/`). Categories: `"*"` (priority 40, lower than Commons because attribution metadata is more variable). Returns CC-licensed images aggregated from Commons + Flickr + others. `subjectId` uses Openverse's `id` field as `openverse:<id>`.
- [ ] 7b.3 `cover_art_archive.ts` — MusicBrainz lookup + Cover Art Archive (`https://coverartarchive.org/release/<mbid>/front`). Categories: `["Album Covers", "Music Albums"]`. Hint flow: search MusicBrainz for release by `hint` → take top match's MBID → fetch front cover. `subjectId` is `mbid:<uuid>`.
- [ ] 7b.4 `jikan.ts` — Jikan API (`https://api.jikan.moe/v4/`) — keyless MyAnimeList proxy. Categories: `["Anime", "Manga Characters", "Anime Characters"]`. Search by hint, take top match's `mal_id`. `subjectId` is `jikan:<id>` for series, `jikan:c-<id>` for characters.
- [ ] 7b.5 `open_library.ts` — Open Library Covers API (`https://covers.openlibrary.org/`). Categories: `["Book Covers", "Books"]`. Search the Open Library Search API for title, take top match's `key`, fetch cover by `OL<id>-L.jpg`. `subjectId` is `openlibrary:<key>`.
- [ ] 7b.6 `nasa.ts` — NASA Images API (`https://images-api.nasa.gov/search`). Categories: `["Space", "Astronomy", "Planets", "Galaxies"]`. Search by hint, take top result. `subjectId` is `nasa:<nasa_id>`.
- [ ] 7b.7 `met.ts` — The Met Open Access API (`https://collectionapi.metmuseum.org/public/collection/v1/`). Categories: `["Paintings", "Sculpture", "Art History"]`. Search by hint, take top object with `isPublicDomain: true` and a primary image URL. `subjectId` is `met:<objectID>`.

### 7c. Source adapters — free-key (opt-in)

Each adapter SHALL return `{ kind: "keyMissing" }` from `find()` when its key is unset, allowing the router to skip cleanly.

- [ ] 7c.1 `inaturalist.ts` — iNaturalist API (`https://api.inaturalist.org/v1/`). Categories: `["Animals", "Plants", "Insects", "Birds", "Marine Biology", "Botany"]`. Free signup at inaturalist.org → API key stored at `config.trivia.visualSources.inaturalist.apiKey` (or `data/auth/inaturalist.json`). Filter to `quality_grade=research` for accuracy. `subjectId` is `inaturalist:<taxon_id>`.
- [ ] 7c.2 `tmdb.ts` — TMDB API v3 (`https://api.themoviedb.org/3/`). Categories: `["Movies", "TV Series", "Actors", "Cinema", "Television"]`. Free key from themoviedb.org. Search appropriate endpoint based on category (movie / tv / person), take top result's poster (movies/tv) or profile photo (actors). `subjectId` is `tmdb:m-<id>` / `tmdb:tv-<id>` / `tmdb:p-<id>`.
- [ ] 7c.3 `rawg.ts` — RAWG API (`https://api.rawg.io/api/`). Categories: `["Video Games"]`. Free key from rawg.io. Search by hint, take top result's `background_image` URL. `subjectId` is `rawg:<id>`.

### 7d. Source adapter tests

- [ ] 7d.1 For each adapter (7b.1 through 7c.3): mock the upstream HTTP layer; verify happy-path returns `{ ok: true, result: { source, subjectId, title, imageUrl, imageBytes, imageMimeType, license, attribution } }`; verify each structured error path (`notFound`, `rateLimit`, `network`, `tooLarge`, `unsupportedFormat`, `unknown`); verify `keyMissing` path for key-gated adapters.
- [ ] 7d.2 Cross-adapter consistency test: every adapter's `SubjectResult` round-trips through `imageAndTextResult` without error.

## 8. find_previous_subjects MCP tool

- [ ] 8.1 Create `src/plugins/trivia/tools/visual/findPreviousSubjects.ts` with args `{ game, subjectId, season? }`
- [ ] 8.2 Load `scoped.loadQuestions()` and filter where `media?.subjectId === args.subjectId`
- [ ] 8.3 Apply `season` filter same shape as `find_previous_questions` (`"all"` default, `"current"`, or explicit slug)
- [ ] 8.4 Return `{ matches: Array<{ id, statement, createdAt, postedAt?, processedAt?, media: { title, subjectId } }>, count }`
- [ ] 8.5 Tests: subject hit; subject miss; season scoping; legacy records without media filtered correctly
- [ ] 8.6 Register the tool in the plugin's MCP server with the same role gate as `find_previous_questions`

## 9. post_questions: Slack file-upload hop

- [ ] 9.1 Update `src/plugins/trivia/tools/questions/postQuestions.ts`: per item, after loading the question record, check if `question.media` is set and `question.media.slackFileId` is unset
- [ ] 9.2 When upload is needed: download `question.media.url` via built-in `fetch` (15-second timeout); upload via Slack `files.uploadV2` with `filename: \`trivia-q-${questionId}.<ext>\`` and `channels: game.channel`. Extract and persist the response's `permalink` as the Slack-hosted URL; persist the `file.id` as `media.slackFileId` (keep both — `permalink` for rendering, `file.id` for idempotency lookup). If `permalink` does not render cleanly in a `hero_image` Block Kit block during implementation, fall back to a `slack_file: { id: <file.id> }` reference in the hero_image (Block Kit supports this shape).
- [ ] 9.3 Stamp `media.slackFileId` (and the resolved Slack-hosted URL — store on a new `media.slackFileUrl` field if needed) on the question record before posting (so re-attempts skip the upload).
- [ ] 9.4 When `media.slackFileId` is already set, skip the upload and reuse the stored Slack URL
- [ ] 9.5 Add a `PostQuestionsSlackDeps` method for the file upload (`uploadImage(opts) → { slackFileId, slackUrl }`) so tests can inject a fake — mirroring the existing seam pattern
- [ ] 9.6 **Card-injection seam (per design.md Decision 4)**: the prompt does NOT build the `hero_image` block. After upload, `post_questions` mutates each item's card block(s) to inject `hero_image: { type: "image", image_url: <slack-url>, alt_text: <question.media.altText> }` for image-medium questions. For text-medium questions, no card mutation happens.
- [ ] 9.7 Truncate `media.altText` to ≤ 2000 characters (Slack's `alt_text` limit) before injecting into the `hero_image`. The stored `media.altText` may be longer; truncation happens at injection time only.
- [ ] 9.8 Tests: happy path (download → upload → card-mutation → post); idempotent skip when slackFileId already set; download failure surfaces as per-item error; download timeout (15s) surfaces as per-item error; transient upload failure (5xx) surfaces as per-item error and does NOT stamp postedAt or slackFileId so the next call retries; permanent upload failure (4xx auth/quota) surfaces as per-item error with the response detail, does NOT stamp postedAt or slackFileId, and admins can manually intervene; text-medium questions (no media) skip the hop entirely; alt_text > 2000 chars is truncated at injection

## 10. add_categories / remove_categories: pool argument

- [ ] 10.1 Update `src/plugins/trivia/tools/categories/addCategories.ts`: add `pool: "default" | "visual" | "both"` arg (default `"default"`). Validate via Zod enum — values other than the three allowed strings reject with a validation error.
- [ ] 10.2 Route writes: `"default"` → existing categories.json; `"visual"` → visualCategories.json; `"both"` → both
- [ ] 10.3 Update `src/plugins/trivia/tools/categories/removeCategories.ts` symmetrically
- [ ] 10.4 Update tool descriptions to document the `pool` argument
- [ ] 10.5 Tests: add to default; add to visual; add to both; remove from each; non-existent removal returns clean response

## 11. upsert_season: promptMedium cascade

- [ ] 11.1 Update `src/plugins/trivia/tools/seasons/upsertSeason.ts` (or wherever season mutation lives) to accept optional `promptMedium` weights on the season entry and slot level
- [ ] 11.2 Mid-season mutation is permitted, mirroring `answersFormat`/`questionType`
- [ ] 11.3 Tests: upsert with promptMedium at season level; with promptMedium per slot; mid-season mutation reflected on next get_ideas

## 12. process_reveal_answers: attribution surfacing

- [ ] 12.1 Update the reveal-payload builder so each `reveals[i]` entry includes `media?: { title, attribution?, license? }` when the question has `media` (drop `url` and `subjectId` — not needed for rendering, avoid leak surface)
- [ ] 12.2 Update `PROCESS_REVEAL_INSTRUCTIONS` (in `src/plugins/trivia/prompts/scheduledPrompts.ts`): when a reveal entry has `media`, the renderer SHALL include one extra `context` block. The block's exact Block Kit shape: `{ type: "context", elements: [{ type: "mrkdwn", text: "📷 Image: <attribution> · <license>" }] }` when both are present; omit ` · <license>` when license is absent; omit the block entirely when both are absent. The emoji is always 📷 (literal Unicode, not a `:camera:` shortcode — shortcodes don't render in context blocks reliably). Multi-question reveals: each question's attribution context block goes immediately after that question's verdict section (before the round summary divider); the cumulative-leaderboard closer is always last.
- [ ] 12.3 Tests for the payload shape: media field included when question has media; absent otherwise; URL never appears in the payload

## 13. Prompt: visual-research subflow + new dispatch paths

- [ ] 13.1 In `src/plugins/trivia/prompts/scheduledPrompts.ts`, add a `VISUAL_RESEARCH_SUBFLOW` constant capturing the *subject-discovery* steps shared across all 6 new visual paths (see design.md Decision 9 — pick category → brainstorm candidates → `find_visual_subject` → **image inspection gate** (see Decision 8.5: subject match, clarity, answer leakage, distinguishing features) → `find_previous_subjects` dedup loop)
- [ ] 13.2 Update `SEND_QUESTIONS_INSTRUCTIONS` to branch on the 3-axis matrix: read `suggestedPromptMedium` from get_ideas; dispatch to the existing 6 text-medium paths OR the 6 new image-medium paths
- [ ] 13.3 `visual+fact+choice` path: VISUAL_RESEARCH_SUBFLOW (category-only subject grounding) → write identification prompt that REQUIRES the image to answer ("Who is this?", "What animal is this?", "Which landmark is shown?") → place subject's title at `suggestedCorrectIndex`, write N-1 same-category-sibling distractors → choice distractor plausibility gate → image-is-question gate (13.13) → difficulty gate → save with `promptMedium: "image"`, `answersFormat: "choice"`, `media`
- [ ] 13.4 `visual+fact+boolean` path: VISUAL_RESEARCH_SUBFLOW (category-only subject grounding) → write claim-based statement that is ABOUT the image's subject (identity claim OR image-grounded property claim — see image-is-question gate in 13.13). Branch on `suggestedAnswer`:
  - **TRUE**: state correct identity ("This is the flag of Ecuador") or a true image-grounded property ("This bird species is native to North America" + Cardinal photo).
  - **FALSE**: swap to a confusable subject ("This is the flag of Colombia" + Ecuador flag) OR claim an image-grounded property that is wrong for the subject shown ("This bird species is native to Europe" + Cardinal photo).
  Run the boolean polarity self-check gate → image-is-question gate (13.13) → difficulty gate → save with `promptMedium: "image"`, `answersFormat: "boolean"`, `media`.
- [ ] 13.5 `visual+fact+freeform` path: VISUAL_RESEARCH_SUBFLOW (category-only subject grounding) → write a typed-identification prompt ("Who is this?", "What animal is this?", "Which landmark is shown?") that REQUIRES the image. Set `expectedAnswer = find_visual_subject.result.title`. Optionally populate `acceptableAnswers` with observed variants (alternate names from the inspection summary, common transliterations). Optionally populate `gradingNotes` when a category-level acceptance pattern helps the reveal-time Haiku judge. No polarity gate, no plausibility gate. Run the image-is-question gate (13.13) → difficulty gate → save with `promptMedium: "image"`, `answersFormat: "freeform"`, `media`, `expectedAnswer`, `acceptableAnswers?`, `gradingNotes?`.
- [ ] 13.6 `visual+topical+choice` path: VISUAL_RESEARCH_SUBFLOW with WebSearch event-grounding step inserted before the candidate brainstorming → same identification prompt-writing + gates as 13.3 → save with `promptMedium: "image"`, `answersFormat: "choice"`, `media`, `sourceUrl`, `eventDate`
- [ ] 13.7 `visual+topical+boolean` path: VISUAL_RESEARCH_SUBFLOW with WebSearch event-grounding → same claim-template statement-writing + gates as 13.4 → save with `promptMedium: "image"`, `answersFormat: "boolean"`, `media`, `sourceUrl`, `eventDate`
- [ ] 13.8 `visual+topical+freeform` path: VISUAL_RESEARCH_SUBFLOW with WebSearch event-grounding → same typed-identification prompt-writing + gates as 13.5 → save with `promptMedium: "image"`, `answersFormat: "freeform"`, `media`, `expectedAnswer`, `acceptableAnswers?`, `gradingNotes?`, `sourceUrl`, `eventDate`
- [ ] 13.9 **Card-rendering seam (resolved per design.md Decision 4)**: the prompt does NOT build a `hero_image` block. The card the prompt constructs for image-medium questions has only `title`, `body`, and optional `subtitle` — no hero_image, no URL of any kind. The hero_image injection happens entirely inside `post_questions` (task 9.6). For image+freeform, the card ALSO carries the `[Answer]` button (injected by the existing freeform flow in `post_questions`); both injections are composable and happen in the same hook.
- [ ] 13.10 Update the duplicate-detection step: in all 6 visual paths, REPLACE the `find_previous_questions` call with `find_previous_subjects({ subjectId })` for subject-level dedup
- [ ] 13.11 **Image+boolean dedup is a required dual-check** (not optional): for image+boolean variants, the dedup step SHALL call BOTH `find_previous_subjects({ subjectId })` AND `find_previous_questions` against the *claim text* (e.g., "This is the flag of Ecuador") with statement-text similarity. Re-roll if EITHER check hits. This dual-check catches both (a) same-subject reuse with different claims and (b) same-claim reuse with different subjects/images. Image+choice and image+freeform do NOT use the dual-check — their prompts are templated ("Who is this?") and would always match.
- [ ] 13.12 Prompt-rendering tests: cover the full 3-axis dispatch (12 combinations: 3 answersFormat × 2 questionType × 2 promptMedium); a snapshot test of the full prompt text is fine
- [ ] 13.13 Add an **image-is-question gate** to all visual paths' statement-writing step. The gate asks Claude to perform a thought experiment: "If I removed the image and showed only the statement, could a player still answer the question?" If yes → REJECT and rewrite. Provide the prompt with worked examples on both sides:
  - VALID (image required): "Who is this?" / "This is the flag of Ecuador. T/F" / "This bird species is native to Europe. T/F" (with a Cardinal photo)
  - INVALID (image decorative): "Birds have hollow bones. T/F" (true regardless of bird shown) / "The capital of France is Paris. T/F" (with an Eiffel Tower photo) / "How many planets in our solar system?" (with a Saturn photo)
  This gate runs BEFORE the polarity / plausibility / difficulty gates — a question that fails this gate is wrong-shaped and shouldn't be evaluated for difficulty.
- [ ] 13.14 **Retry budget for the visual research subflow** (covers both inspection gate failures and image-is-question gate failures): up to 3 candidate re-rolls within the same category (calling `find_visual_subject` with a different hint), then up to 2 category re-rolls (moving to a different entry in `categories.ideas`). If all attempts fail, the visual path SHALL abort and re-roll the entire `get_ideas` call once — this MAY yield a text-medium question, which is the expected graceful degradation. Document the budget in the prompt so Claude can self-pace.

## 14. CREATE_SCHEDULES_INSTRUCTIONS / requiredTools

- [ ] 14.1 Add `mcp__trivia__find_visual_subject` and `mcp__trivia__find_previous_subjects` to the `requiredTools` list for **Schedule A — Send question** (the question-posting schedule, as named in `CREATE_SCHEDULES_INSTRUCTIONS`). These tool names MUST exactly match the names registered in the plugin's MCP server (tasks 7a.7 and 8.6).
- [ ] 14.2 Verify `buildGameSpecs` in `src/plugins/trivia/core/buildGameSpecs.ts` (which emits the same `requiredTools` list for config-driven scheduled jobs) includes both new tools. Run the existing `buildGameSpecs` tests and confirm a snapshot or assertion covers the new tools.
- [ ] 14.3 Add a test (in `buildGameSpecs.test.ts` or sibling) asserting that the emitted `requiredTools` for question-posting includes both new tool names verbatim, preventing typo-drift between the MCP server registration and the schedule's tool list.

## 15. Documentation

- [ ] 15.1 Update `CLAUDE.md` (the trivia plugin section): document the `promptMedium` axis, the visual category pool, the multi-source registry shape, and the dependency on both `add-trivia-topical-questions` and `add-trivia-freeform-questions` having shipped
- [ ] 15.2 Update any per-game / role-based instruction overrides that reference question types
- [ ] 15.3 Note in the visual-pool docs that pop-culture coverage (album covers, movie scenes) is sparse on Commons and admins should curate accordingly

## 16. Validation and acceptance

- [ ] 16.1 Run `openspec validate add-trivia-visual-questions --strict` and resolve any spec-coherence issues
- [ ] 16.2 Manual smoke test: enable `promptMedium: { text: 0, image: 1 }` on a dev game with a populated visual pool; verify a question generates, posts with a Slack-hosted image, reveals with attribution
- [ ] 16.3 Manual smoke test: configure `image + topical` weights; verify a recent-event visual question generates with both `media` and `sourceUrl`
- [ ] 16.4 Confirm zero-config installs are unchanged (the existing test suite passes without modification)
