## 1. Core types and data model

- [x] 1.1 Update `src/plugins/trivia/core/types.ts`: add `promptMedium?: "text" | "image"` to `TriviaQuestion`; add `media?: QuestionMedia` to `TriviaQuestion`; export new `QuestionMedia` interface (`kind`, `url`, `altText`, `subjectId`, `title`, `license?`, `attribution?`, `slackFileId?`)
- [x] 1.2 Add `PromptMediumWeights = Record<"text" | "image", number>` to `core/configTypes.ts` (NOT `types.ts` — all sibling weight types live in `configTypes.ts`)
- [x] 1.3 Extend `SeasonEntry` and `SeasonFormatSlot` with optional `promptMedium?: PromptMediumWeights`. Per the full-cascade decision, ALSO add `promptMedium?` to `TriviaGame` (game tier) and `TriviaConfig` (workspace tier)
- [x] 1.4 Document the "absent promptMedium reads as text" convention next to the field definition

## 2. Config schema

- [x] 2.1 Add `promptMedium?: PromptMediumWeights` to `TriviaConfig` in `core/configTypes.ts` (NOT `src/config.ts` — trivia config is plugin-owned per the plugin hard rules). Wired through the shared axis bag (`parseTriviaAxisBag` + `Object.assign`) so workspace + game tiers parse it; slot tier added in `configParsers/format.ts`. (No `visualSources` config — image-search plugins own their own config, separately.)
- [x] 2.2 Add `validatePromptMediumMap` + `PROMPT_MEDIUM_KEYS` + `promptMediumZod` to `configParsers/axes.ts` (only keys `text`/`image`, non-negative integers, at least one positive); register in `TriviaAxisBag`, `parseTriviaAxisBag`, `axisFieldsZod`, and the `seasonFormatSlotZod`
- [x] 2.3 Export `DEFAULT_PROMPT_MEDIUM_WEIGHTS = { text: 1, image: 0 }` (in `core/configTypes.ts`, next to `DEFAULT_QUESTION_TYPE_WEIGHTS`)
- [x] 2.4 Add validator tests: `promptMedium` (valid, partial map accepted, all-zero rejected, unknown-key rejected, non-integer/negative rejected) — `configParsers/promptMedium.test.ts`

## 3. (removed) Visual category pool

Image-medium questions draw from the existing `categories.json` pool — there is no separate visual pool. See design.md Decision 3. No data-layer, seed, or config work is needed here.

## 4. Domain: promptMedium resolution

- [x] 4.1 Create `src/plugins/trivia/domain/promptMediums.ts` (sibling to `factTopical.ts`)
- [x] 4.2 Implement `resolvePromptMedium(currentSeason, slotIndex, game, config) → PromptMediumWeights` + `getActivePromptMedium(...)` — cascade `slot → season → game → config → DEFAULT_PROMPT_MEDIUM_WEIGHTS` (full game tier per the cascade decision), mirroring `resolveQuestionType`/`getActiveQuestionType`
- [x] 4.3 Tests (`promptMediums.test.ts`): default fallback; config/season/game/slot overrides; precedence (slot>season>game>config); absent cascade levels skipped — 12 cases

## 5. get_ideas integration

- [x] 5.1 Update `src/plugins/trivia/tools/questions/getIdeas.ts`: roll `suggestedPromptMedium` from `resolvePromptMedium()` weights via existing `weightedPick`. The roll is fully independent of `suggestedAnswersFormat` — no cross-axis constraint.
- [x] 5.2 Category resolution is medium-agnostic: `categories.ideas` is drawn from the same `categories.json` pool (with the existing season/slot cascade and recent-exclusion window) regardless of `suggestedPromptMedium`. No separate visual pool, no special resolution branch. When an image roll lands on a category with no good visual subject, the prompt's research subflow re-roll budget handles it (task 13.14) — there is no `get_ideas`-side fallback.
- [x] 5.3 Response shape: add `suggestedPromptMedium` to the return payload. Keep all existing fields unchanged and emit them per the rolled answersFormat regardless of promptMedium: when `suggestedAnswersFormat === "choice"`, emit `suggestedChoiceCount` and `suggestedCorrectIndex`; when `suggestedAnswersFormat === "boolean"`, emit `suggestedAnswer`. The three axes roll independently — image rolls don't change which answerFormat-specific suggestions get emitted.
- [x] 5.4 Added `getIdeas.medium.test.ts` covering: text-only config produces all-text rolls; image-only config produces all-image rolls; image+boolean, image+choice, and image+freeform combos emerge naturally; `categories.ideas` is drawn from the same pool whether the roll is text or image; mixed weights produce all 6 promptMedium × answersFormat combinations with expected proportions over many rolls

## 6. save_question validation

- [x] 6.1 Update `src/plugins/trivia/tools/questions/saveQuestion.ts`: accept `promptMedium` (optional enum) and `media` (optional object, no `slackFileId` input — stamped by post_questions) as input args
- [x] 6.2 Validate: `promptMedium === "image"` REQUIRES `media` to be set. No restriction on `answersFormat` — boolean, choice, and freeform all combine freely with image medium.
- [x] 6.3 Validate: non-empty `media.url`/`altText`/`subjectId`/`title`; `media.url` must be HTTPS; `altText` ≤2000 chars with Slack control sequences stripped (`kind` pinned to `"image"` literal by zod)
- [x] 6.4 Validate: `promptMedium === "text"` (or absent) FORBIDS `media`
- [x] 6.5 When saving, stamp `promptMedium` on the record (even when `"text"`) and `media` when present
- [x] 6.6 Tests covering all 6 promptMedium × answersFormat combinations (`saveQuestion.media.test.ts`, 11 cases) + updated all existing save_question call sites for the two new arg keys: the 3 image-medium combos (image+boolean, image+choice, image+freeform) save with media; the 3 text-medium combos (text+boolean, text+choice, text+freeform) reject when media is passed; media validation (missing fields, wrong kind, non-HTTPS URL); media-required-when-image enforcement; round-trip of every combination

## 7. External image-search tool contract (documentation only)

This proposal does NOT ship any image-search adapters — those land as separate proposals (`add-commons-image-search-plugin`, `add-brave-image-search-plugin`, etc.). The work in this section is purely documentation: pin the contract that image-search plugins must follow.

- [x] 7.1 Created `docs/image-search-contract.md` (the repo's `docs/` is the version-controlled home for plugin docs like `brave-plugin.md`; `data/default_configuration/owner/` doesn't exist in this repo and is a gitignored runtime override path). It documents the external image-search MCP tool contract:
  - **Naming**: tool name MUST contain the substring `image_search` (e.g., `mcp__commons_image_search__find_subject`, `mcp__brave_image_search__find_image`).
  - **Arguments**: at minimum a `query: string` (free-form subject hint). MAY accept additional optional args.
  - **Success return**: a multimodal tool result with (a) a base64 image content block in the MCP shape `{ type: "image", data, mimeType }` (data mode — URL-source image blocks are not expressible in MCP tool results; see design.md Decision 5); (b) a text content block carrying the metadata JSON: `{ source, subjectId, title, imageUrl, license?, attribution?, format }` where `format` is always `"data"`.
  - **`subjectId` namespacing**: source-prefixed (`commons:`, `wikidata:`, `tmdb:m-`, `brave:`, etc.). Trivia's `find_previous_subjects` matches exact-string only.
  - **Error return**: structured discriminator `kind: "notFound" | "rateLimit" | "network" | "tooLarge" | "unsupportedFormat" | "unknown" | "keyMissing"`.
- [x] 7.2 `docs/image-search-contract.md` is the canonical authors' doc; `CLAUDE.md`'s trivia section links to it (§15.1).
- [x] 7.3 No code added to trivia in this section (contract is documentation only; the prompt in §13 drives discovery/use).

## 7b. Multimodal tool result helper (platform-level — RESOLVED, see note)

- [x] 7b.1 **Blocking dependency — RESOLVED.** The Claude Agent SDK's `tool(...)` helper supports returning multimodal content (image content block + text content block). The image block uses the MCP `CallToolResult` shape `{ type: "image", data: "<base64>", mimeType }` — **data mode only**. There is NO URL-source image block in the MCP tool-result content union (`source: { type: "url" }` is the Anthropic Messages-API shape, not the tool-result shape); repo precedent `src/tools/query/viewSlackImage.ts` confirms base64-only. Resolved by `add-commons-image-search-plugin` design Decision 1.
- [x] 7b.2 No shared `imageAndTextResult` helper is required at the platform level — each image-search plugin assembles the two-block result inline (see `src/plugins/commons-image-search/findSubject.ts` and `src/plugins/brave-image-search/findImage.ts`, which each define a local `imageAndTextResult`). If a future refactor wants to DRY this, lift it into the plugin SDK; not a blocker for any proposal.

(Note: image-search plugins each build the data-mode multimodal result themselves. This section is now informational — the dependency it gated is resolved.)

- [x] 8.1 Create `src/plugins/trivia/tools/visual/findPreviousSubjects.ts` with args `{ game, subjectId, season? }`
- [x] 8.2 Load `scoped.loadQuestions()` and filter where `media?.subjectId === args.subjectId`
- [x] 8.3 Apply `season` filter (`"all"` default, `"current"`, or explicit slug)
- [x] 8.4 Return `{ matches: Array<{ id, statement, createdAt, postedAt?, processedAt?, media: { title, subjectId } }>, count }`
- [x] 8.5 Tests (`findPreviousSubjects.test.ts`, 6): hit; miss (no cross-namespace); legacy/no-media filtered; season scoping; empty-subjectId + unknown-game rejection
- [x] 8.6 Registered in `index.ts` with `member` role gate (same as `find_previous_questions`) + `label.find_previous_subjects` i18n (en/fr)

## 9. post_questions: Slack file-upload hop

- [x] 9.1 Update `src/plugins/trivia/tools/questions/postQuestions.ts`: per item, after loading the question record, check if `question.media` is set and `question.media.slackFileId` is unset
- [x] 9.2 When upload is needed: download `question.media.url` via built-in `fetch` (15-second timeout, matching the spec). Verify the response is a supported raster format (JPEG/PNG/WebP/GIF) from `Content-Type` (fall back to URL extension); reject SVG/other types as a per-item error — `post_questions` re-fetches `imageUrl` here independently of the plugin's inspection-time download, so this is trivia's own format gate before the Slack upload. Derive `<ext>` from the detected `Content-Type` (`image/jpeg` → `jpg`, etc.), falling back to the URL extension, else `jpg`. Upload via Slack `files.uploadV2` with `filename: \`trivia-q-${questionId}.<ext>\`` and `channels: game.channel`. Extract `file.id` AND `permalink` from the response.
- [x] 9.3 Stamp BOTH fields on the question record before posting (so re-attempts skip the upload): `media.slackFileId = file.id` (used for idempotency lookup) and `media.slackFileUrl = permalink` (used at render time as the `hero_image.image_url`). If during implementation `permalink` does not render cleanly in a `hero_image` Block Kit block, fall back to using a `slack_file: { id: <file.id> }` reference in the hero_image; in that case, `media.slackFileUrl` MAY be omitted and the rendered `hero_image` references the file id directly. Pick one strategy and apply it consistently.
- [x] 9.4 When `media.slackFileId` is already set, skip the upload and reuse the stored Slack URL
- [x] 9.5 Add a `PostQuestionsSlackDeps` method for the file upload (`uploadImage(opts) → { slackFileId, slackUrl }`) so tests can inject a fake — mirroring the existing seam pattern
- [x] 9.6 **Card-injection seam (per design.md Decision 4)**: the prompt does NOT build the `hero_image` block. After upload, `post_questions` mutates each item's card block(s) to inject `hero_image: { type: "image", image_url: <slack-url>, alt_text: <question.media.altText> }` for image-medium questions. For text-medium questions, no card mutation happens. **Image+freeform composability**: when both the hero_image injection (this proposal) and the `[Answer]` button injection (from the freeform proposal's existing flow) fire on the same card, the hero_image renders first (top, visual prominence), the title/body text below, and the `[Answer]` button at the bottom (immediate action). Verify the existing freeform button injection point does not collide with hero_image insertion.
- [x] 9.7 Truncate `media.altText` to ≤ 2000 characters (Slack's `alt_text` limit) before injecting into the `hero_image`. The stored `media.altText` may be longer; truncation happens at injection time only.
- [x] 9.8 Tests: happy path (download → upload → card-mutation → post); idempotent skip when slackFileId already set; download failure surfaces as per-item error; download timeout (15s) surfaces as per-item error; unsupported format (e.g., SVG via Content-Type) surfaces as per-item error and does NOT upload; transient upload failure (5xx) surfaces as per-item error and does NOT stamp postedAt or slackFileId so the next call retries; permanent upload failure (4xx auth/quota) surfaces as per-item error with the response detail, does NOT stamp postedAt or slackFileId, and admins can manually intervene; text-medium questions (no media) skip the hop entirely; alt_text > 2000 chars is truncated at injection

## 10. (removed) add_categories / remove_categories: pool argument

No `pool` argument is added. Since image-medium questions reuse the existing `categories.json` pool (design.md Decision 3), `add_categories` / `remove_categories` are unchanged by this proposal.

## 11. upsert_season: promptMedium cascade

- [x] 11.1 Update `src/plugins/trivia/tools/seasons/upsertSeason.ts` (or wherever season mutation lives) to accept optional `promptMedium` weights on the season entry and slot level
- [x] 11.2 Mid-season mutation is permitted, mirroring `answersFormat`/`questionType`
- [x] 11.3 Tests: upsert with promptMedium at season level; with promptMedium per slot; mid-season mutation reflected on next get_ideas

## 12. process_reveal_answers: attribution surfacing

- [x] 12.1 Update the reveal-payload builder so each `reveals[i]` entry includes `media?: { title, attribution?, license? }` when the question has `media` (drop `url` and `subjectId` — not needed for rendering, avoid leak surface)
- [x] 12.2 Update `PROCESS_REVEAL_INSTRUCTIONS` (in `src/plugins/trivia/prompts/scheduledPrompts.ts`): when a reveal entry has `media`, the renderer SHALL include one extra `context` block. The block's exact Block Kit shape: `{ type: "context", elements: [{ type: "mrkdwn", text: "📷 Image: <attribution> · <license>" }] }` when both are present; omit ` · <license>` when license is absent; omit the block entirely when both are absent. The emoji is always 📷 (literal Unicode, not a `:camera:` shortcode — shortcodes don't render in context blocks reliably). Multi-question reveals: each question's attribution context block goes immediately after that question's verdict section (before the round summary divider); the cumulative-leaderboard closer is always last.
- [x] 12.3 Tests for the payload shape: media field included when question has media; absent otherwise; URL never appears in the payload

## 13. Prompt: visual-research subflow + new dispatch paths

- [x] 13.1 In `src/plugins/trivia/prompts/scheduledPrompts.ts`, add a `VISUAL_RESEARCH_SUBFLOW` constant capturing the *subject-discovery* steps shared across all 6 new visual paths (see design.md Decision 9 — pick category → brainstorm candidates → **pick an `*_image_search__*` tool from the available list** matching the category (abort to text if none available) → call it with the candidate as `query` → **image inspection gate** (see Decision 8.5: subject match, clarity, answer leakage, distinguishing features) → `find_previous_subjects` dedup loop)
- [x] 13.2 Update `SEND_QUESTIONS_INSTRUCTIONS` to branch on the 3-axis matrix: read `suggestedPromptMedium` from get_ideas; dispatch to the existing 6 text-medium paths OR the 6 new image-medium paths. Image-medium dispatch is guarded by tool availability — if no `*_image_search__*` tool is present in Claude's tool list, the dispatch immediately falls back to the text-medium path for the same `answersFormat × questionType`.
- [x] 13.3 `visual+fact+choice` path: VISUAL_RESEARCH_SUBFLOW (category-only subject grounding) → write identification prompt that REQUIRES the image to answer ("Who is this?", "What animal is this?", "Which landmark is shown?") → place subject's title (from the image-search tool's metadata `title` field) at `suggestedCorrectIndex`, write N-1 same-category-sibling distractors → choice distractor plausibility gate → image-is-question gate (13.13) → difficulty gate → save with `promptMedium: "image"`, `answersFormat: "choice"`, `media`
- [x] 13.4 `visual+fact+boolean` path: VISUAL_RESEARCH_SUBFLOW (category-only subject grounding) → write claim-based statement that is ABOUT the image's subject (identity claim OR image-grounded property claim — see image-is-question gate in 13.13). Branch on `suggestedAnswer`:
  - **TRUE**: state correct identity ("This is the flag of Ecuador") or a true image-grounded property ("This bird species is native to North America" + Cardinal photo).
  - **FALSE**: swap to a confusable subject ("This is the flag of Colombia" + Ecuador flag) OR claim an image-grounded property that is wrong for the subject shown ("This bird species is native to Europe" + Cardinal photo).
  Run the boolean polarity self-check gate → image-is-question gate (13.13) → difficulty gate → save with `promptMedium: "image"`, `answersFormat: "boolean"`, `media`.
- [x] 13.5 `visual+fact+freeform` path: VISUAL_RESEARCH_SUBFLOW (category-only subject grounding) → write a typed-identification prompt ("Who is this?", "What animal is this?", "Which landmark is shown?") that REQUIRES the image. Set `expectedAnswer` to the `title` field from the image-search tool's metadata block. Optionally populate `acceptableAnswers` with observed variants (alternate names from the inspection summary, common transliterations). Optionally populate `gradingNotes` when a category-level acceptance pattern helps the reveal-time Haiku judge. No polarity gate, no plausibility gate. Run the image-is-question gate (13.13) → difficulty gate → save with `promptMedium: "image"`, `answersFormat: "freeform"`, `media`, `expectedAnswer`, `acceptableAnswers?`, `gradingNotes?`.
- [x] 13.6 `visual+topical+choice` path: VISUAL_RESEARCH_SUBFLOW with WebSearch event-grounding step inserted before the candidate brainstorming → same identification prompt-writing + gates as 13.3 → save with `promptMedium: "image"`, `answersFormat: "choice"`, `media`, `sourceUrl`, `eventDate`
- [x] 13.7 `visual+topical+boolean` path: VISUAL_RESEARCH_SUBFLOW with WebSearch event-grounding → same claim-template statement-writing + gates as 13.4 → save with `promptMedium: "image"`, `answersFormat: "boolean"`, `media`, `sourceUrl`, `eventDate`
- [x] 13.8 `visual+topical+freeform` path: VISUAL_RESEARCH_SUBFLOW with WebSearch event-grounding → same typed-identification prompt-writing + gates as 13.5 → save with `promptMedium: "image"`, `answersFormat: "freeform"`, `media`, `expectedAnswer`, `acceptableAnswers?`, `gradingNotes?`, `sourceUrl`, `eventDate`
- [x] 13.9 **Card-rendering seam (resolved per design.md Decision 4)**: the prompt does NOT build a `hero_image` block. The card the prompt constructs for image-medium questions has only `title`, `body`, and optional `subtitle` — no hero_image, no URL of any kind. The hero_image injection happens entirely inside `post_questions` (task 9.6). For image+freeform, the card ALSO carries the `[Answer]` button (injected by the existing freeform flow in `post_questions`); both injections are composable and happen in the same hook.
- [x] 13.10 Update the duplicate-detection step: in all 6 visual paths, REPLACE the `find_previous_questions` call with `find_previous_subjects({ subjectId })` for subject-level dedup
- [x] 13.11 **Image+boolean dedup is a required dual-check** (not optional): for image+boolean variants, the dedup step SHALL call BOTH `find_previous_subjects({ subjectId })` AND `find_previous_questions` against the *claim text* (e.g., "This is the flag of Ecuador") with statement-text similarity. Re-roll if EITHER check hits. This dual-check catches both (a) same-subject reuse with different claims and (b) same-claim reuse with different subjects/images. Image+choice and image+freeform do NOT use the dual-check — their prompts are templated ("Who is this?") and would always match.
- [x] 13.12 Prompt-rendering tests: cover the full 3-axis dispatch (12 combinations: 3 answersFormat × 2 questionType × 2 promptMedium); a snapshot test of the full prompt text is fine
- [x] 13.13 Add an **image-is-question gate** to all visual paths' statement-writing step. The gate asks Claude to perform a thought experiment: "If I removed the image and showed only the statement, could a player still answer the question?" If yes → REJECT and rewrite. Provide the prompt with worked examples on both sides:
  - VALID (image required): "Who is this?" / "This is the flag of Ecuador. T/F" / "This bird species is native to Europe. T/F" (with a Cardinal photo)
  - INVALID (image decorative): "Birds have hollow bones. T/F" (true regardless of bird shown) / "The capital of France is Paris. T/F" (with an Eiffel Tower photo) / "How many planets in our solar system?" (with a Saturn photo)
  This gate runs BEFORE the polarity / plausibility / difficulty gates — a question that fails this gate is wrong-shaped and shouldn't be evaluated for difficulty.
- [x] 13.14 **Retry budget for the visual research subflow** (covers both inspection gate failures and image-is-question gate failures): up to 3 candidate re-rolls within the same category (calling the chosen image-search tool with a different `query`, OR switching to another available `*_image_search__*` tool), then up to 2 category re-rolls (moving to a different entry in `categories.ideas`). If all attempts fail, the visual path SHALL abort and fall back to the text-medium path for the same `answersFormat × questionType`. **No-tool-available short-circuit**: if Claude's tool list contains zero `*_image_search__*` tools at dispatch time (step 3 of VISUAL_RESEARCH_SUBFLOW), abort the visual path immediately without consuming the retry budget — the fallback is graceful. Document the budget and the short-circuit in the prompt so Claude can self-pace.

## 14. CREATE_SCHEDULES_INSTRUCTIONS / requiredTools

- [x] 14.1 Add `mcp__trivia__find_previous_subjects` to the `requiredTools` list for **Schedule A — Send question** in `CREATE_SCHEDULES_INSTRUCTIONS`. This tool name MUST exactly match the registration in task 8.6.
- [x] 14.2 Do NOT hard-code any `*_image_search__*` tool name in `requiredTools` — image-search tools come from external plugins that are independently installed. The trivia prompt detects available tools at runtime via Claude's tool list; the scheduled job's `requiredTools` only declares what trivia itself owns. Document this in `CREATE_SCHEDULES_INSTRUCTIONS` so future plugin authors don't add image-search names to trivia's list.
- [x] 14.3 Verify `buildGameSpecs` in `src/plugins/trivia/core/buildGameSpecs.ts` (which emits the same `requiredTools` list for config-driven scheduled jobs) includes `find_previous_subjects`. Run the existing `buildGameSpecs` tests and confirm a snapshot or assertion covers it.

## 15. Documentation

- [x] 15.1 Updated `CLAUDE.md` (trivia section): documents the `promptMedium` axis, same-pool category reuse, the external image-search contract (links to `docs/image-search-contract.md`), the graceful no-tool fallback, and the topical+freeform dependency
- [x] 15.2 No checked-in per-game / role instruction override references question types — the generation prompt (`scheduledPrompts.ts`) is the single source and was updated in §13. (Runtime overrides under `data/` are gitignored and admin-owned.)
- [x] 15.3 `docs/image-search-contract.md` + `CLAUDE.md` both note visual coverage depends on installed plugins and that poorly-covered categories re-roll to text
- [x] 15.4 `docs/image-search-contract.md` "Enabling visual trivia rounds" section: set `promptMedium.image > 0` + install an image-search plugin (start with `commons-image-search`)

## 16. Validation and acceptance

- [x] 16.1 `openspec validate add-trivia-visual-questions --strict` → valid.
- [ ] 16.2 **MANUAL (requires live Slack + installed `commons-image-search` + a cron fire).** Happy paths: (a) image+choice generates, posts with Slack-hosted image, reveals with attribution; (b) image+boolean produces a confusable-swap or property claim, reveals correctly; (c) image+freeform produces a typed-identification question with [Answer] button + hero_image both rendered.
- [ ] 16.3 **MANUAL (requires live Slack + cron fire).** Failure paths: (a) upstream image 404 during post (verify per-item error surfaces, question NOT marked posted, next fire retries); (b) image roll lands on a poorly-covered category with `promptMedium: { image: 1 }` (verify the research-subflow re-roll budget exhausts and falls back to text-medium, no errors); (c) **no image-search plugin installed** with `promptMedium: { image: 1 }` (verify visual path short-circuits at step 3 of VISUAL_RESEARCH_SUBFLOW and falls back to text-medium); (d) image+topical with WebSearch event-grounding (verify `media` AND `sourceUrl` AND `eventDate` all saved). Run smoke tests (a), (b), (d) with `commons-image-search` plugin installed.
- [x] 16.4 Zero-config installs unchanged: default `promptMedium` is `{ text: 1, image: 0 }`, so no visual question rolls without explicit opt-in; full suite green (1045 trivia tests + i18n parity, tsc clean, lint clean).
