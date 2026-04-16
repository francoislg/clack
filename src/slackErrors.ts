/**
 * Structured-error helpers for the Slack Web API.
 *
 * Slack SDK errors wrap API errors in an Error whose `data.error` carries the raw API
 * code (e.g., "channel_not_found"). Inspecting that code is more robust than matching
 * the wrapped message string, which varies with SDK version.
 */

/**
 * Shape of errors thrown by `@slack/web-api`. Type-only — narrowed at runtime in
 * `slackErrorCode` via property checks.
 */
type SlackLikeError = Error & { data?: { error?: string } };

function hasSlackData(error: Error): error is SlackLikeError {
  if (!("data" in error)) return false;
  const data = (error as SlackLikeError).data;
  return typeof data === "object" && data !== null;
}

/**
 * Extract the Slack platform error code (e.g. "channel_not_found") from a thrown
 * Web API error. Returns undefined when the input isn't a Slack-SDK error.
 */
export function slackErrorCode(error: Error | null | undefined): string | undefined {
  if (!error) return undefined;
  if (!hasSlackData(error)) return undefined;
  const code = error.data?.error;
  return typeof code === "string" ? code : undefined;
}

/**
 * Slack API error codes indicating Clack can't reach the target channel/DM —
 * either the channel doesn't exist for the bot or the bot isn't a member.
 */
const SLACK_ACCESS_ERROR_CODES = new Set(["channel_not_found", "not_in_channel"]);

/**
 * Detect a Slack access error from either a raw error object (preferred — uses the
 * structured API code) or a stringified message (fallback for call sites that already
 * lost the original Error, e.g., after `toErrorMessage(err)`).
 */
export function isSlackAccessError(errorOrMessage: Error | string | null | undefined): boolean {
  if (errorOrMessage instanceof Error) {
    const code = slackErrorCode(errorOrMessage);
    if (code && SLACK_ACCESS_ERROR_CODES.has(code)) return true;
    const message = errorOrMessage.message;
    for (const accessCode of SLACK_ACCESS_ERROR_CODES) {
      if (message.includes(accessCode)) return true;
    }
    return false;
  }
  if (typeof errorOrMessage !== "string") return false;
  for (const accessCode of SLACK_ACCESS_ERROR_CODES) {
    if (errorOrMessage.includes(accessCode)) return true;
  }
  return false;
}
