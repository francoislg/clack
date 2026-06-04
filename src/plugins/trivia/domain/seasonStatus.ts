import { CronExpressionParser } from "cron-parser";
import { triviaLogger as logger } from "../core/pluginLogger.js";

/**
 * Compute the next-fire instant of a cron expression strictly after `after`.
 * Returns null when the expression is invalid (a warning is logged with the cron text).
 * Plugin-local — derives timing from a cron string the plugin owns (e.g. a game's
 * `revealCron`); it does NOT consult the bot-core cron-job registry.
 */
export function nextCronFireAfter(
  cronExpression: string,
  timezone: string | undefined,
  after: Date,
): Date | null {
  try {
    const interval = CronExpressionParser.parse(cronExpression, {
      currentDate: after,
      tz: timezone,
    });
    return interval.next().toDate();
  } catch (error) {
    logger.error(
      `nextCronFireAfter: invalid cron "${cronExpression}" tz="${timezone}": ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/**
 * Whether `nextFire` is the season's last reveal before it ends — true when the
 * next reveal fire lands after the season's `expectedEndAt`. A `null` `nextFire`
 * (an unparseable cron — a misconfiguration) is treated as the last fire, so a
 * broken schedule still lets the season close rather than running forever.
 */
export function isLastFireBeforeSeasonEnd(nextFire: Date | null, expectedEndAt: number): boolean {
  return nextFire === null || nextFire.getTime() > expectedEndAt;
}
