import type { App } from "@slack/bolt";
import { ErrorCode, type WebAPIPlatformError } from "@slack/web-api";
import { logger } from "../../logger.js";
import { summarizeForSlack } from "../../claude.js";

function isMsgTooLong(error: unknown): error is WebAPIPlatformError {
  if (!(error instanceof Error)) return false;
  const platformError = error as WebAPIPlatformError;
  return (
    platformError.code === ErrorCode.PlatformError &&
    (platformError.data?.error === "msg_too_long" || platformError.data?.error === "invalid_blocks")
  );
}

/**
 * Wrapper around client.chat.update that catches msg_too_long / invalid_blocks errors,
 * summarizes the text via Claude, and retries. Falls back to hard truncation as last resort.
 */
export async function safeChatUpdate(
  client: App["client"],
  channel: string,
  ts: string,
  text: string,
): Promise<void> {
  try {
    await client.chat.update({ channel, ts, text });
  } catch (error) {
    if (!isMsgTooLong(error)) throw error;

    logger.warn(`msg_too_long / invalid_blocks posting change result, summarizing via Claude...`);
    const shortened = await summarizeForSlack(text);

    try {
      await client.chat.update({ channel, ts, text: shortened });
    } catch (retryError) {
      if (!isMsgTooLong(retryError)) throw retryError;

      // Last resort: hard truncate
      logger.warn(`Summarized text still too long, hard-truncating`);
      const truncated = text.substring(0, 39000) + "\n\n(truncated — full output was too long for Slack)";
      await client.chat.update({ channel, ts, text: truncated });
    }
  }
}
