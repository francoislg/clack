## Context

Clack curates a closed subset of Slack Block Kit blocks: `divider`, `header`, `section`, `context`, `image`, `markdown`. The subset is enforced at the `submit_response` MCP tool boundary via a zod discriminated union (`BlockSchema`), then validated against per-type Slack limits (`validateBlocks`), prepared for delivery (`prepareBlocks`), and walked for text extraction (`extractDisplayText`). A separate top-level `table` parameter on `submit_response` and `post_to` covers tabular content; tables are NOT a member of the `Block` union (Slack always renders tables at the bottom of the message and rejects multi-table payloads, so they live outside `blocks`).

Slack now ships two newer block types — `card` and `carousel` — but the installed `@slack/types@2.20.0` (and 2.20.1) does not yet export interfaces for them. (`TaskCardBlock` exists but is unrelated — it is the AI work-object plan block, `type: "task_card"`.) The Slack docs for both blocks (linked in the proposal) describe the runtime shape clearly enough to hand-roll the types.

Stakeholders: this is a Claude-authored capability — Claude is the consumer of the new schema. Validation messages must be actionable enough for Claude to self-correct on retry.

## Goals / Non-Goals

**Goals:**
- Allow Claude to author `card` and `carousel` blocks via `submit_response`, `post_to.blocks`, and `propose_change.blocks` with the same scope as every other block type.
- Validate cards against Slack's documented limits (title 150, subtitle 150, body 200; "at least one of hero_image/title/actions/body") with friendly errors.
- Validate carousels against Slack's documented bounds (1–10 child cards; children must be cards).
- Convert internal markdown to Slack mrkdwn on card text fields, including inside carousel children.
- Walk card and carousel content in `extractDisplayText` for the 10000-char total + plain-text fallback.
- Make the path back to first-party `@slack/types` cheap when it lands.

**Non-Goals:**
- Card-level interactive buttons (`actions` field on Card). Deferred to a follow-up — see Decisions.
- Surface gating (e.g., disallowing cards in certain contexts). Same scope as today's blocks.
- A new Action type for cards. Top-level `actions: Action[]` continues to be the only encoded-button path.

## Decisions

### Decision: Hand-roll types in `src/slack/customSlackTypes.ts`, mirror upstream shape

Create a new file `src/slack/customSlackTypes.ts` that exports `CardBlock` and `CarouselBlock` interfaces. The file's top-of-file comment documents:
1. Why these exist (upstream `@slack/types` doesn't ship them yet).
2. The removal trigger ("when `@slack/types` exports `CardBlock` / `CarouselBlock`, delete this file and update imports").
3. A link to the Slack docs page for each block.

The interfaces extend the same `Block` base type that `@slack/types` uses for its own block types, so the call-site experience matches first-party types.

**Alternatives considered:**
- Use `looseObject` and skip TypeScript types entirely. Rejected: every other block in `Block` (the runtime union) has a concrete `@slack/types` interface; consumers (`extractDisplayText`, `prepareBlocks`, `validateBlocks`) read fields by name and benefit from compile-time safety.
- Forward-declare in `blockSchema.ts` directly. Rejected: makes the migration noisier (one diff vs. many) and bundles "this is temporary" alongside permanent code.

### Decision: For v1, disallow `actions` field inside a Card

The Slack Card block accepts an `actions` array (raw Slack `Button` elements). Clack's existing `actions: Action[]` on `submit_response` is not raw buttons — it's an encoded shape (`followup` / `choice` / `post_to` / `change` / `config_update` / `update`) that gets serialized with the session ID and (for ref-bearing actions) validated against the intent store. Action-button rendering also enforces a 75-char label limit, persists `post_to` snapshots, and runs the staged-intent coverage check.

Bringing that machinery inside Card means:
- Recursing into card blocks during `getStructuredResponseBlocks` to encode card-internal actions.
- Recursing during snapshot persistence so post_to actions inside cards work.
- Recursing during `validateActionButtonLabels` and `validateStagedIntentsCoverage`.
- Defining whether a Card `actions` field accepts raw `Button` elements OR Clack-style `Action` objects (or both).

That is a meaningful redesign of Clack's action pipeline. v1 punts: the schema explicitly rejects an `actions` field on Card with an error message that points Claude at the top-level `actions: Action[]` field. Cards are allowed to render with `hero_image` + `title` + `subtitle` + `body` + `icon`, which is most of the value.

A follow-up change can revisit this once we have real usage data on whether card-internal buttons are wanted.

**Alternatives considered:**
- Accept raw `Button` elements in Card.actions, no encoding. Rejected: buttons that don't trigger Clack actions are mostly useless in this context (no URL-only button use case is concrete enough yet).
- Accept Clack `Action[]` and encode at render time. Rejected as a v1 scope decision — see above.

### Decision: Carousel children are validated as cards

Carousel uses `elements: CardBlock[]` (1–10). The validator recurses: for each carousel element, it checks `type === "card"` (rejecting other types with a clear error), then runs the card validator. This keeps card validation in one place — the carousel validator just enforces count and type.

Slack docs note "each card requires a unique block_id" inside a carousel. We do not enforce uniqueness in v1: Slack auto-generates `block_id` when omitted, so as long as Claude doesn't manually set duplicate IDs (which it has no reason to), the rule is moot. If this turns into a real failure mode we can add uniqueness validation later.

### Decision: `prepareBlocks` recurses into Carousel; markdown conversion runs on Card text fields

Card fields `title`, `subtitle`, `body` are documented as mrkdwn-text. `prepareBlocks` runs `convertMarkdownToSlack` on each. The 200-char body limit is well below the 3000-char section split threshold, so no splitting is needed; oversize bodies simply fail validation (Claude shortens and retries).

Carousel `elements` are recursed: `prepareBlocks` walks each element through the card preparer.

### Decision: `extractDisplayText` walks card and carousel content

For the 10000-char display-total check and plain-text fallback, `extractDisplayText` adds:
- `card`: concatenate `title`, `subtitle`, `body` (in that order, separated by `\n\n` like other blocks). `hero_image.alt_text` and `icon.alt_text` contribute too if present.
- `carousel`: concatenate the recursive walk of each child card.

### Decision: Same surface scope as every other block type

Cards and carousels are accepted everywhere a `Block` is accepted today: `submit_response.blocks`, `submit_response.actions[].blocks` (for `post_to`), and `propose_change.blocks`. No new gating. The risk is documented in the proposal.

## Risks / Trade-offs

- **[Slack server-side surface restriction]** → If a Slack surface rejects `card`/`carousel` at delivery, Claude sees a Slack API error not a Clack validation error. **Mitigation:** the error reaches Claude via `delivery_failed` and Claude can adjust on retry. If this becomes a frequent failure mode, add explicit surface gating in a follow-up.
- **[Hand-rolled types drift from upstream]** → When `@slack/types` ships these, our hand-rolled shape might disagree on optional-field details. **Mitigation:** the file header documents the removal trigger; a quick diff at upgrade time catches mismatches. The runtime schema uses `looseObject` so unknown fields pass through unchanged.
- **[Card char limits are tight]** → 200-char body in particular is far below Section's 3000. Claude may try cards for content that doesn't fit. **Mitigation:** `block-kit-formatting.md` documents the limits and gives concrete shape guidance ("repos / PRs / sessions, not long-form answers").
- **[No card-level actions in v1]** → Claude may want a "card with an inline button" affordance and find none. **Mitigation:** validation error explicitly points at the top-level `actions` field; documentation also calls this out. Follow-up change can add card-level actions if real usage demands it.

## Migration Plan

Pure additive change to a curated subset. No data migration. No backwards-compat break: existing block authors continue to work unchanged. New block types become available immediately on deploy.

## Open Questions

None at this time. Carousel doc was confirmed: `type: "carousel"`, `elements: CardBlock[]` (1–10), `block_id` optional. Card limits confirmed from the Slack docs page. v1 scope decisions documented above.
