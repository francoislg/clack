import { errorMessage } from "../errors.js";
import { logger } from "../logger.js";
import { slackErrorCode } from "../slackErrors.js";

export type SlackErrorFormatter = (operation: string) => string;

/** A Claude-facing message builder for one feature: logs the failure, maps a Slack error code through `messages`, and falls back to the raw code or error text. */
export function createSlackErrorMessage(
  logPrefix: string,
  messages: ReadonlyMap<string, SlackErrorFormatter>,
): (operation: string, error: unknown) => string {
  return (operation, error) => {
    logger.warn(`${logPrefix}: ${operation} failed: ${errorMessage(error)}`);
    const code = slackErrorCode(error instanceof Error ? error : undefined);
    if (code === undefined) return `${operation} failed: ${errorMessage(error)}`;
    const format = messages.get(code);
    return format ? format(operation) : `Slack rejected ${operation}: ${code}.`;
  };
}
