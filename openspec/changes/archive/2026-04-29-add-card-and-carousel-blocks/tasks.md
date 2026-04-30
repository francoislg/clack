## 1. Hand-rolled types

- [x] 1.1 Create `src/slack/customSlackTypes.ts` with `CardBlock` and `CarouselBlock` interfaces matching the Slack docs shape (card: optional `block_id`, `hero_image`, `icon`, `title`, `subtitle`, `body`; carousel: `elements: CardBlock[]`, optional `block_id`). Include a top-of-file comment naming the upstream-removal trigger and linking to both Slack doc pages.
- [x] 1.2 In the same file, define `CardImageObject` (or reuse `@slack/types`'s image object) for `hero_image` / `icon`. Confirm shape: `{ type: "image", image_url: string, alt_text: string }`.

## 2. Schema (zod) and Block union

- [x] 2.1 In `src/slack/blockSchema.ts`, import the new types. Add `cardImageObjectSchema` (`type: "image"`, `image_url`, `alt_text`).
- [x] 2.2 Add `cardBlockSchema` as a `z.looseObject`. Implementation note: the original task called for a `.refine()` to reject the `actions` field at parse time, but `.refine()` on a discriminated-union member breaks Zod's narrowing (the variant becomes a `ZodPipe` rather than a `ZodObject`, and the inferred type for the union breaks downstream consumers like `PostToAction.blocks: Block[]`). The rejection moved to `validateCard` instead — same Claude-facing error surface.
- [x] 2.3 Add `carouselBlockSchema` as a `z.looseObject` with `type: literal("carousel")` and `elements: z.array(cardBlockSchema).min(1).max(10)`.
- [x] 2.4 Add both to the `BlockSchema` discriminated union. Extend the `Block` exported type union and `ALLOWED_BLOCK_TYPES`.

## 3. Validator

- [x] 3.1 In `src/slack/blockValidate.ts`, add constants: `CARD_TITLE_LIMIT = 150`, `CARD_SUBTITLE_LIMIT = 150`, `CARD_BODY_LIMIT = 200`, `CAROUSEL_MIN_ELEMENTS = 1`, `CAROUSEL_MAX_ELEMENTS = 10`.
- [x] 3.2 Add a `validateCard(block, i, opts?)` function. `opts` accepts an optional `{ inCarousel: { carouselIndex: number, elementIndex: number } }` so error field paths look like `blocks[i].title` for top-level cards and `blocks[i].elements[j].title` for carousel children.
- [x] 3.3 In `validateCard`, enforce: title ≤ 150, subtitle ≤ 150, body ≤ 200, hero_image must have `image_url` and `alt_text`, icon must have `image_url` and `alt_text`, and at-least-one-of-`hero_image`/`title`/`actions`/`body` rule. **Also rejects an inline `actions` field** (the schema-level refine was moved here — see 2.2).
- [x] 3.4 Add a `validateCarousel(block, i)` function. Enforce 1 ≤ `elements.length` ≤ 10. For each element, if `type !== "card"` push an error; otherwise call `validateCard` with `inCarousel` opts.
- [x] 3.5 Wire both into the `validateBlocks` switch on `block.type`.

## 4. Preparer

- [x] 4.1 In `src/slack/blockPrepare.ts`, add `prepareCard(block)` that runs `convertMarkdownToSlack` on `title`, `subtitle`, `body` when their `type === "mrkdwn"` (matches `prepareTextObject`'s logic). Leave `hero_image` and `icon` untouched.
- [x] 4.2 Add `prepareCarousel(block)` that maps each element through `prepareCard`.
- [x] 4.3 Wire both into the `prepareBlocks` switch on `block.type`. Body length is below the 3000-char split threshold, so no splitting is needed.

## 5. Display-text extractor

- [x] 5.1 In `src/slack/blockText.ts`, extend `extractDisplayText` with a `case "card":` that pushes `title`, `subtitle`, `body` (in that order, when present), plus `hero_image.alt_text` and `icon.alt_text` when present. Also added a `case "markdown":` since the prior change had left it as a silent no-op.
- [x] 5.2 Add a `case "carousel":` that recursively walks each child card.

## 6. Tool descriptions and instruction docs

- [x] 6.1 Update the `blocks` field description in `src/tools/presentation/submitResponse.ts` (both the normal schema and the post_to action's `blocks` field) to list `card` and `carousel` in the curated subset. Done via the shared `messageContentFields` fragment so both surfaces inherit the change.
- [x] 6.2 ~~Update the `blocks` field description in `src/tools/actions/proposeChange.ts` to match.~~ N/A: `propose_change` does not accept Block Kit blocks today (its schema is `branch, description, repo, plan` only). Removing the description-update task — there is no blocks field to update. The proposal/design references to `propose_change.blocks` are stale relative to the current tool surface.
- [x] 6.3 Update `data/default_configuration/user/block-kit-formatting.md`: add `card` and `carousel` block descriptions with their limits; document the v1 "no card-level actions" restriction; add a "when to use Card / Carousel" guidance paragraph (repo / PR / session summaries — not long-form answers).
- [x] 6.4 Update `data/default_configuration/user/submit-response.md` to list `card` and `carousel` in the curated subset enumeration.
- [x] 6.5 Update `data/default_configuration/user/slack-formatting.md`'s one-line subset reference.

## 7. Tests

- [x] 7.1 Add `blockSchema.test.ts` cases: card schema accepts a minimal valid card (one of hero_image/title/actions/body); accepts a card with passthrough `actions` (validator catches it, not the schema); accepts a carousel with 1–10 cards; rejects a carousel with 0 or 11+ elements at parse time.
- [x] 7.2 Add `blockValidate.test.ts` cases: card title > 150 chars; card subtitle > 150 chars; card body > 200 chars; card with none of the required fields; card hero_image missing image_url; card icon missing alt_text; card with inline `actions` (validator-level rejection); carousel with a non-card element; carousel whose child card violates a card limit (verify error path contains both indices).
- [x] 7.3 Add `blockPrepare.test.ts` cases: prepareCard converts mrkdwn in title/subtitle/body; prepareCarousel applies prepareCard to each child; hero_image / icon pass through unchanged; input is not mutated.
- [x] 7.4 Add `blockText.test.ts` cases: extractDisplayText walks card fields in title/subtitle/body order, then alt_texts; absent fields are omitted; carousel text is the concatenation of its children's text. Also added a markdown-block extraction test (filling a pre-existing gap surfaced by 5.1).
- [x] 7.5 Updated `ALLOWED_BLOCK_TYPES` test (now lists 8 sorted entries including `card` and `carousel`); updated the "rejects newer AI-surface block types" test (kept `alert` rejection, removed the now-stale `card` / `carousel` rejection assertions).

## 8. Verification

- [x] 8.1 Run `npx tsc` — type-check passes with the new hand-rolled types feeding through schema, validator, preparer, and text extractor.
- [x] 8.2 Run `npm run test` — all new and existing tests pass. 3,046 tests pass (+22 net).
- [x] 8.3 Run `openspec validate add-card-and-carousel-blocks --strict` and confirm it passes.
