import type { SlackBlocks } from "./blocks.js";
import { extractDisplayText } from "./blockText.js";
import type { Block } from "./blockSchema.js";
import { unfurlOptions } from "./unfurlOptions.js";

// New Clack send paths SHOULD route through this module. The `suppressUnfurls`
// option (see PostStructuredMessageOpts below) is translated via
// `unfurlOptions` from ./unfurlOptions.js — that helper is the single source
// of truth for how Clack maps the opt-in onto Slack's `unfurl_links` /
// `unfurl_media` params. Authors of a new direct `chat.postMessage` call
// should spread `unfurlOptions(suppressUnfurls)` into their args.

/**
 * Truncated plain-text fallback derived from rendered blocks. Slack uses it for
 * push notifications and screen readers — never shown inline when blocks render.
 * Capped at 500 chars to keep notifications short.
 */
export function notificationText(blocks: SlackBlocks): string {
  const text = extractDisplayText(blocks as Block[]);
  return text.length > 500 ? text.slice(0, 497) + "..." : text;
}

/**
 * Narrow client contract: just the two chat methods this helper needs. Lets
 * test fakes implement only these without constructing a full `App["client"]`.
 * Production code passes the real `App["client"]`, which structurally satisfies
 * this interface.
 */
export interface MessagePostingClient {
  chat: {
    postMessage: (args: {
      channel: string;
      text: string;
      blocks: SlackBlocks;
      thread_ts?: string;
      unfurl_links?: false;
      unfurl_media?: false;
    }) => Promise<{ ts?: string }>;
    getPermalink: (args: { channel: string; message_ts: string }) => Promise<{
      permalink?: string;
    }>;
  };
}

export interface PostStructuredMessageOpts {
  channel: string;
  blocks: SlackBlocks;
  threadTs?: string;
  /**
   * When true, the posted message disables Slack link and media unfurling
   * (both `unfurl_links: false` and `unfurl_media: false`). When absent or
   * false, Slack's default unfurling applies.
   */
  suppressUnfurls?: boolean;
}

export interface PostStructuredMessageResult {
  ts: string;
  permalink: string;
}

/**
 * Post a Block Kit message and return the Slack ts plus a permalink. The single
 * primitive every "post a top-level structured artifact and remember where it
 * went" path in Clack should use — submit_response's top-level delivery, plugin
 * tools that own their own posting, etc.
 *
 * Throws when chat.postMessage fails to return a ts, or when chat.getPermalink
 * fails to return a permalink. Reactions are NOT attached here — pair with
 * `addDeliveryReactions` from `messageReactions.ts`.
 */
export async function postStructuredMessage(
  client: MessagePostingClient,
  opts: PostStructuredMessageOpts,
): Promise<PostStructuredMessageResult> {
  const postResult = await client.chat.postMessage({
    channel: opts.channel,
    text: notificationText(opts.blocks),
    blocks: opts.blocks,
    ...(opts.threadTs ? { thread_ts: opts.threadTs } : {}),
    ...unfurlOptions(opts.suppressUnfurls),
  });
  const ts = postResult.ts;
  if (!ts) {
    throw new Error("chat.postMessage returned no ts");
  }
  const linkResult = await client.chat.getPermalink({
    channel: opts.channel,
    message_ts: ts,
  });
  const permalink = linkResult.permalink;
  if (!permalink) {
    throw new Error("chat.getPermalink returned no permalink");
  }
  return { ts, permalink };
}
