/**
 * Format `now` in `timezone` using `en-CA` (which emits `YYYY-MM-DD`), then return the
 * `YYYY-MM-DD` and `MM-DD` slices. Shared by the cron scheduler's skip-date comparison and
 * the state-backup routine's dated-directory label so timezone-aware date keys have one source
 * of truth. Throws (RangeError) on an invalid IANA timezone — callers that accept untrusted
 * input guard accordingly.
 */
export function dateKeysInTimezone(now: Date, timezone: string): { ymd: string; md: string } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const ymd = formatter.format(now);
  return { ymd, md: ymd.slice(5) };
}
