## Why

Slack recently added two new Block Kit block types — `card` and `carousel` — that present a richer, structured layout suitable for entity summaries (repos, PRs, sessions). Clack's curated subset (`divider`, `header`, `section`, `context`, `image`, `markdown`) cannot express the card shape today. Adding these two block types lets Claude render compact, scannable summaries that fit naturally in a Slack feed.

`@slack/types` does not yet ship `CardBlock` / `CarouselBlock` interfaces (as of `2.20.1`). We will hand-roll the types in a dedicated file, with a TODO to remove them once the upstream package catches up.

## What Changes

- Add `card` and `carousel` to the curated block subset accepted by `submit_response`, `post_to.blocks`, and `propose_change.blocks` — same surface scope as every other block type today.
- Hand-roll `CardBlock` and `CarouselBlock` TypeScript interfaces in a new `src/slack/customSlackTypes.ts` file, structured to mirror what `@slack/types` is expected to ship. File header documents the removal trigger ("when `@slack/types` exports these, delete this file and import from there instead").
- Extend `BlockSchema` (zod) with discriminated-union arms for `card` and `carousel`. Extend `ALLOWED_BLOCK_TYPES`.
- Extend `validateBlocks` with per-field char limits — card: `title` ≤ 150, `subtitle` ≤ 150, `body` ≤ 200, plus the "at least one of `hero_image`, `title`, `actions`, `body`" rule from Slack's docs. Carousel: 1–10 child cards (validated via Slack's documented bounds). Carousel children are validated as cards.
- Extend `prepareBlocks` to convert internal markdown to Slack mrkdwn on card `title`/`subtitle`/`body` text, and to recurse into carousel `elements`.
- Extend `extractDisplayText` to walk card title/subtitle/body and carousel children for the 10000-char total + plain-text fallback.
- For v1, **disallow `actions` inside Card.** Card-level action buttons would need their own encoding/persistence path (sessionId, ref-coverage validation) which is a much larger change. Top-level `actions: Action[]` on `submit_response` continue to be the only path to interactive buttons. Validation rejects any `actions` field on a card with a clear error pointing Claude at the top-level `actions` field.
- Update `data/default_configuration/user/block-kit-formatting.md` and `submit-response.md` to document the new block types, their limits, and the v1 "no card-level actions" restriction.
- Update the schema description string in `src/tools/presentation/submitResponse.ts` and `src/tools/actions/proposeChange.ts` to list `card` and `carousel` in the curated subset.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `clack-tool-response`: Extends `Claude-Authored Block Kit Responses` to include `card` and `carousel` in the curated subset; extends `Centralized Block Validation With Friendly Errors` with new per-type validation rules.

## Impact

- **Code:** `src/slack/customSlackTypes.ts` (new), `src/slack/blockSchema.ts`, `src/slack/blockValidate.ts`, `src/slack/blockPrepare.ts`, `src/slack/blockText.ts`, `src/slack/blocks.ts` (no behavior change but `Block` union widens), `src/tools/presentation/submitResponse.ts` (schema description only), `src/tools/actions/proposeChange.ts` (schema description only).
- **Configuration:** `data/default_configuration/user/block-kit-formatting.md`, `data/default_configuration/user/submit-response.md`, `data/default_configuration/user/slack-formatting.md` (one-line subset reference).
- **Tests:** new cases in `blockSchema.test.ts`, `blockValidate.test.ts`, `blockPrepare.test.ts`, `blockText.test.ts`, plus the `submitResponse.test.ts` description list if asserted.
- **Dependencies:** none. We are intentionally NOT bumping `@slack/types` to ship these types — we ship our own and migrate when upstream lands them.
- **Risk:** Slack's Card/Carousel block surface support is not fully documented (the published pages don't enumerate which surfaces accept them). If a surface rejects them at delivery, Claude sees a Slack API error rather than a friendly Clack validation error. We accept this risk for v1; a follow-up can add explicit surface gating if needed.
