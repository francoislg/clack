import type { ReactionsAddResponse, ReactionsRemoveResponse } from "@slack/web-api";
import { errorMessage } from "../errors.js";
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
    remove: (args: {
      channel: string;
      timestamp: string;
      name: string;
    }) => Promise<ReactionsRemoveResponse>;
  };
}

/**
 * Add emoji reactions to a posted message. Failures are logged as warnings but
 * never affect the delivery result; `already_reacted` is silently ignored.
 *
 * Pauses `delayBetweenMs` (default 150ms) between calls. Without the pause,
 * Slack reorders rapid same-bot reactions at display time even though we send
 * them in order — the delay lets each one commit before the next lands.
 *
 * Returns a Promise so tests can await completion, but callers in the
 * production code path fire-and-forget — the function never rejects.
 */
export async function addDeliveryReactions(
  client: ReactionsClient,
  channel: string,
  timestamp: string,
  reactions: string[],
  delayBetweenMs = 150,
): Promise<void> {
  for (let i = 0; i < reactions.length; i++) {
    const emoji = reactions[i];
    try {
      await client.reactions.add({ channel, timestamp, name: emoji });
    } catch (err) {
      const msg = errorMessage(err);
      if (!msg.includes("already_reacted")) {
        logger.warn(`Failed to add reaction :${emoji}: — ${msg}`);
      }
    }
    if (i < reactions.length - 1 && delayBetweenMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayBetweenMs));
    }
  }
}

/** Remove one reaction this bot added. Never throws: `no_reaction` (already gone) is ignored
 *  silently; any other failure is logged. */
export async function removeDeliveryReaction(
  client: ReactionsClient,
  channel: string,
  timestamp: string,
  emoji: string,
): Promise<void> {
  try {
    await client.reactions.remove({ channel, timestamp, name: emoji });
  } catch (err) {
    const msg = errorMessage(err);
    if (!msg.includes("no_reaction")) {
      logger.warn(`Failed to remove reaction :${emoji}: — ${msg}`);
    }
  }
}
