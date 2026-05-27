/**
 * Channelless cron job dispatch helpers.
 *
 * Channelless plugin-managed cron jobs have no bound delivery channel — they decide
 * the destination at fire time by reading recent activity across candidates and
 * calling `post_to`. The scheduler / `processMessage` pipeline is built around a
 * required `channelId: string`, so at the dispatch boundary we synthesize a sentinel
 * value here (e.g., `channelless:abc123`). Downstream Slack-API call sites MUST guard
 * against the sentinel before passing it to `client.conversations.info`, `chat.postMessage`,
 * etc. Sessions still store the sentinel for lookup symmetry — it never collides with a
 * real Slack channel ID (which begins with C/G/D), and the session/lookup machinery
 * doesn't need to special-case it.
 */

const CHANNELLESS_PREFIX = "channelless:";

/** Build the sentinel channel ID for a channelless cron job's dispatch. */
export function makeChannellessChannelId(jobId: string): string {
  return CHANNELLESS_PREFIX + jobId;
}

/**
 * True when the channel ID is a channelless dispatch sentinel (not a real Slack channel).
 * Tolerates `undefined` so callers handling partial session fixtures (tests, in-flight
 * setup) don't have to pre-guard.
 */
export function isChannellessChannelId(channelId: string | undefined): boolean {
  return channelId !== undefined && channelId.startsWith(CHANNELLESS_PREFIX);
}
