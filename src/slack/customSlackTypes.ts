/**
 * Hand-rolled TypeScript types for Slack Block Kit blocks not yet exported by
 * `@slack/types`. Keep this file small — every type here is *temporary*.
 *
 * Removal trigger: when `@slack/types` exports `CardBlock` and `CarouselBlock`,
 * delete this file and update imports to use the upstream types.
 *
 * Slack docs:
 * - Card block:     https://docs.slack.dev/reference/block-kit/blocks/card-block/
 * - Carousel block: https://docs.slack.dev/reference/block-kit/blocks/carousel-block/
 */
import type { Block, MrkdwnElement } from "@slack/types";

/**
 * Image object used by `card.hero_image` and `card.icon`. Same shape as the
 * URL-based image used elsewhere in Block Kit: `{ type: "image", image_url,
 * alt_text }`. We hand-roll it here rather than reusing `@slack/types`'s
 * `UrlImageObject` because that interface lacks the `type` discriminator and
 * `alt_text` field — the card-image variant carries both.
 */
export interface CardImageObject {
  type: "image";
  image_url: string;
  alt_text: string;
}

/**
 * Slack `card` block: a richer, structured layout for entity summaries. Per
 * the Slack docs, at least one of `hero_image`, `title`, `actions`, or `body`
 * must be present. Clack's v1 disallows the `actions` field — see the
 * `Claude-Authored Block Kit Responses` requirement and the design doc for
 * `add-card-and-carousel-blocks`.
 */
export interface CardBlock extends Block {
  type: "card";
  hero_image?: CardImageObject;
  icon?: CardImageObject;
  title?: MrkdwnElement;
  subtitle?: MrkdwnElement;
  body?: MrkdwnElement;
}

/**
 * Slack `carousel` block: an ordered list of 1–10 child cards. Each child must
 * be a `CardBlock`. Slack auto-generates `block_id` per child if omitted.
 */
export interface CarouselBlock extends Block {
  type: "carousel";
  elements: CardBlock[];
}
