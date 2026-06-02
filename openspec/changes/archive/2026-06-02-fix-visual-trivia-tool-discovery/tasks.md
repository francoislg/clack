# Tasks

## 1. Prompt — discovery by description

- [x] 1.1 In `src/plugins/trivia/prompts/scheduledPrompts.ts`, rewrite `VISUAL_RESEARCH_SUBFLOW` step (c) to discover image tools by **description** (capability: takes a subject query, returns an image inline + the metadata block), not by the substring `image_search`. Keep the category-fit selection guidance.
- [x] 1.2 Rewrite the no-tool short-circuit in the same step: "if none of your available tools is a trivia image source, abort the visual path immediately (no retry budget spent) and generate a text question for the same `answersFormat × questionType`."
- [x] 1.3 Replace remaining `*_image_search__*` references in `scheduledPrompts.ts` (retry-budget step (g) line ~402, dispatch note line ~440, subflow note line ~483, and the `requiredTools` NOTE line ~935) with description-based wording.

## 2. Tool descriptions / wording sweep

- [x] 2.1 `getIdeas.ts:51` — reword the `suggestedPromptMedium` doc: drop `*_image_search__*`, describe "an available image-search tool (identified by its description)".
- [x] 2.2 `saveQuestion.ts:78,130` — reword the `media` description to reference "the image-search tool's metadata block" without the `*_image_search__*` token.
- [x] 2.3 `upsertSeason.ts:125` — reword "requires an installed `*_image_search__*` plugin" to "requires an installed image-search plugin".
- [x] 2.4 `core/configTypes.ts:55` and `core/types.ts:40` — update the comments referencing `*_image_search__*`.
- [x] 2.5 `domain/buildGameSpecs.ts:15,18` — update the NOTE comment about not listing image-search tools in `requiredTools` to drop the underscore token.

## 3. Fix the wrong plugin docstrings

- [x] 3.1 `src/plugins/commons-image-search/index.ts:11` — comment claims the tool "resolves to `mcp__commons_image_search__find_subject`". Correct it to the real name `mcp__commons-image-search__find_subject` and note that discovery is description-based.
- [x] 3.2 `src/plugins/brave-image-search/index.ts:11` — same correction for `mcp__brave-image-search__find_image`.

## 4. Docs

- [x] 4.1 `docs/image-search-contract.md` — rewrite the **Tool naming** section into **Tool discovery**: discovery is by description; a recognizable name (`*-image-search`) is recommended, not required. Fix the example tool names to hyphenated form. Update `commons-image-search/README.md` and `brave-image-search/README.md` likewise.

## 5. Spec

- [x] 5.1 Apply the `trivia-visual-questions` spec delta (this change's `specs/` folder) to `openspec/specs/trivia-visual-questions/spec.md` — synced during `/opsx:archive`.

## 6. Verify

- [x] 6.1 `npx tsc --noEmit` clean; `npm test` green (5135 passed; the prior `image_search`-substring test assertions were updated to assert description-based discovery).
- [ ] 6.2 Manual (requires live Slack + scheduled run — not runnable in this environment): with `commons-image-search` installed and `promptMedium: { text: 0, image: 1 }`, trigger a scheduled run; confirm Claude calls `mcp__commons-image-search__find_subject` and posts an image question (not a silent text fallback).
- [ ] 6.3 Manual (requires live Slack + scheduled run): with NO image plugin installed and image weight > 0, confirm graceful text fallback, no error.

## 7. Follow-ups (not in this change)

- [x] 7.1 Note in `add-commons-image-search-plugin`, `add-brave-image-search-plugin`, `add-tmdb-image-search-plugin` proposals that the `*_image_search__*` discovery convention is superseded by description-based discovery; reconcile when next worked on.
