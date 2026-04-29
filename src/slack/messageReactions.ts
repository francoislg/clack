import type { ReactionsAddResponse } from "@slack/web-api";
import { logger } from "../logger.js";

/**
 * Narrow client contract: just the `reactions.add` call we need. This avoids
 * pulling in the full `App["client"]` type so test fakes can satisfy the
 * contract without a double-cast.
 */
export interface ReactionsClient {
  reactions: {
    add: (args: {
      channel: string;
      timestamp: string;
      name: string;
    }) => Promise<ReactionsAddResponse>;
  };
}

/**
 * Add emoji reactions to a posted message. Failures are logged as warnings but
 * never affect the delivery result; `already_reacted` is silently ignored.
 *
 * Shared helper used by `submit_response` delivery and `post_to` cross-post
 * delivery so reaction-application semantics stay consistent across surfaces.
 */
export async function addDeliveryReactions(
  client: ReactionsClient,
  channel: string,
  timestamp: string,
  reactions: string[],
): Promise<void> {
  for (const emoji of reactions) {
    try {
      await client.reactions.add({ channel, timestamp, name: emoji });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("already_reacted")) {
        logger.warn(`Failed to add reaction :${emoji}: — ${msg}`);
      }
    }
  }
}
