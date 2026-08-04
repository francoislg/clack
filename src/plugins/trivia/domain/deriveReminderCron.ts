import { triviaLogger } from "../core/pluginLogger.js";

/**
 * Derive a reminder cron expression that fires one hour before a reveal.
 *
 * Shifts the HOUR field (index 1) back by exactly 1. Returns null when:
 * - The hour field is 0 (shifting crosses midnight, ambiguous with day-of-week/month)
 * - The hour field contains *, ,, -, or / (list/range/step/wildcard — no single well-defined shift)
 * - The cron string does not split into exactly 5 whitespace-separated fields
 *
 * All other fields are preserved verbatim.
 *
 * Pure function except for the warning log on invalid input.
 */
export function deriveReminderCron(revealCron: string): string | null {
  const parts = revealCron.trim().split(/\s+/);

  if (parts.length !== 5) {
    triviaLogger.warn(
      `deriveReminderCron: expected 5 cron fields, got ${parts.length} from "${revealCron}"`,
    );
    return null;
  }

  const hourField = parts[1];

  // Check if hour field is a single integer
  if (!/^\d+$/.test(hourField)) {
    triviaLogger.warn(
      `deriveReminderCron: hour field "${hourField}" is not a single integer (contains list/range/step/wildcard)`,
    );
    return null;
  }

  const hour = parseInt(hourField, 10);

  // Hour must be in range 1-23 (not 0, which crosses midnight)
  if (hour < 1 || hour > 23) {
    triviaLogger.warn(
      `deriveReminderCron: hour field ${hour} is outside valid range 1-23 (hour 0 crosses midnight)`,
    );
    return null;
  }

  const newHour = hour - 1;
  return `${parts[0]} ${newHour} ${parts[2]} ${parts[3]} ${parts[4]}`;
}
