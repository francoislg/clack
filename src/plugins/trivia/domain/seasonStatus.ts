import { CronExpressionParser } from "cron-parser";
import { triviaLogger as logger } from "../core/pluginLogger.js";
import { findOffDay } from "./offDays.js";
import type { OffDay } from "../core/configTypes.js";

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
 * Upper bound on consecutive off-day fires skipped by {@link nextRevealFireAfter} — ample
 * for any realistic schedule (a daily cron covers years), and it keeps a sub-daily cron
 * over a long off-day run from looping without end.
 */
const MAX_OFF_DAY_SKIPS = 1000;

/**
 * The next instant after `after` at which a reveal cron actually runs: the next fire of
 * `cronExpression`, skipping fires that land on an off-day (the core scheduler skips
 * those via the job's `skipDates`; {@link findOffDay} matches with the same semantics,
 * on the fire's calendar date in `timezone`). Returns null
 * when the cron is unparseable, or when every one of the first {@link MAX_OFF_DAY_SKIPS}
 * fires lands on an off-day — nothing runs in that stretch, so it reads as "no next fire".
 * An invalid timezone never reaches `findOffDay`: cron-parser rejects it, so
 * `nextCronFireAfter` returns null first.
 */
export function nextRevealFireAfter(
  cronExpression: string,
  timezone: string | undefined,
  after: Date,
  offDays: readonly OffDay[] | undefined,
): Date | null {
  let fire = nextCronFireAfter(cronExpression, timezone, after);
  for (let skipped = 0; fire !== null && findOffDay(offDays, fire, timezone) !== null; skipped++) {
    if (skipped >= MAX_OFF_DAY_SKIPS) {
      logger.warn(
        `nextRevealFireAfter: every one of ${MAX_OFF_DAY_SKIPS} fires of "${cronExpression}" after ${after.toISOString()} lands on an off-day`,
      );
      return null;
    }
    fire = nextCronFireAfter(cronExpression, timezone, fire);
  }
  return fire;
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

/**
 * The one "is this the season's last reveal" rule, shared by `compute_answers`,
 * `check_season_status`, and `end_season`: resolve the next reveal fire after `now`
 * (skipping off-days via {@link nextRevealFireAfter}) and compare it to the season's
 * `expectedEndAt` via {@link isLastFireBeforeSeasonEnd}. An absent or empty
 * `revealCron` can't confirm the last fire, so it reads as NOT the last fire.
 */
export function resolveLastFireOfSeason(params: {
  revealCron: string | undefined;
  timezone: string | undefined;
  now: Date;
  offDays: readonly OffDay[] | undefined;
  expectedEndAt: number;
}): { nextFire: Date | null; isLastFireOfSeason: boolean } {
  const { revealCron, timezone, now, offDays, expectedEndAt } = params;
  if (!revealCron) return { nextFire: null, isLastFireOfSeason: false };
  const nextFire = nextRevealFireAfter(revealCron, timezone, now, offDays);
  return { nextFire, isLastFireOfSeason: isLastFireBeforeSeasonEnd(nextFire, expectedEndAt) };
}
