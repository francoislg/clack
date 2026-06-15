import { CronExpressionParser } from "cron-parser";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAME_MAP: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

// Returns undefined for an invalid zone so callers fall back to a safe default.
function shortTzAbbreviation(date: Date, timezone: string): string | undefined {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      timeZoneName: "short",
    }).formatToParts(date);
    return parts.find((p) => p.type === "timeZoneName")?.value;
  } catch {
    return undefined;
  }
}

// When `viewerTimezone` is given, the tz abbreviation is appended only when the job's zone
// resolves to a different abbreviation than the viewer's at the next-run instant; otherwise
// (or when omitted) it is always appended.
export function humanReadableSchedule(
  cronExpression: string,
  timezone: string,
  viewerTimezone?: string,
): string {
  try {
    const interval = CronExpressionParser.parse(cronExpression, { tz: timezone });
    const next = interval.next().toDate();
    const baseTime = next.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
    });
    const jobAbbr = shortTzAbbreviation(next, timezone);
    const showTz =
      viewerTimezone === undefined || jobAbbr !== shortTzAbbreviation(next, viewerTimezone);
    const timeStr = showTz && jobAbbr ? `${baseTime} ${jobAbbr}` : baseTime;

    const fields = cronExpression.split(/\s+/);
    if (fields.length < 5) return cronExpression;

    const [minute, hour, dayOfMonth, , dayOfWeek] = fields;

    const subDaily = formatSubDaily(minute, hour, dayOfMonth, dayOfWeek);
    if (subDaily) return subDaily;

    if (dayOfWeek !== "*" && dayOfMonth === "*") {
      const days = parseDayOfWeek(dayOfWeek);
      if (days.length === 7) return `Every day at ${timeStr}`;
      if (days.length === 5 && !days.includes("Sat") && !days.includes("Sun")) {
        return `Weekdays at ${timeStr}`;
      }
      return `Every ${days.join(", ")} at ${timeStr}`;
    }

    if (dayOfMonth !== "*") {
      return `Day ${dayOfMonth} of each month at ${timeStr}`;
    }

    return `Every day at ${timeStr}`;
  } catch {
    return cronExpression;
  }
}

function formatSubDaily(
  minute: string,
  hour: string,
  dayOfMonth: string,
  dayOfWeek: string,
): string | null {
  if (dayOfMonth !== "*") return null;

  const hourInfo = parseHourField(hour);
  if (!hourInfo) return null;

  const minuteSuffix = minute === "0" ? "" : ` at :${minute.padStart(2, "0")}`;

  let base: string;
  if (hourInfo.step > 1) {
    base = `Every ${hourInfo.step} hours${minuteSuffix}`;
  } else {
    const minuteStep = parseMinuteStep(minute);
    if (minute === "*" || minuteStep === 1) {
      base = "Every minute";
    } else if (minuteStep) {
      base = `Every ${minuteStep} minutes`;
    } else {
      base = `Every hour${minuteSuffix}`;
    }
  }

  const hourRangeSuffix = hourInfo.range
    ? ` from ${formatHour(hourInfo.range[0])} to ${formatHour(hourInfo.range[1])}`
    : "";
  const dayOfWeekSuffix = formatDayOfWeekSuffix(dayOfWeek);

  return `${base}${hourRangeSuffix}${dayOfWeekSuffix}`;
}

function parseHourField(hour: string): { step: number; range?: [number, number] } | null {
  if (hour === "*") return { step: 1 };
  const stepMatch = /^\*\/(\d+)$/.exec(hour);
  if (stepMatch) return { step: Number(stepMatch[1]) };

  // A single literal hour ("6") stays out of sub-daily form — it humanizes as "Every day at TIME".
  // Ranges ("9-17") and comma lists ("0-8,18-23", the idler's off-hours complement) describe a window.
  if (!hour.includes("-") && !hour.includes(",")) return null;

  const hours = expandHourList(hour);
  if (!hours) return null;
  const segments = circularRuns(hours);
  if (segments.length === 1) return { step: 1, range: segments[0] };
  return null;
}

// Expand "0-8,18-23" / "9-17" / "1,3,5" into a sorted unique hour list [0..23]; null on any bad token.
function expandHourList(field: string): number[] | null {
  const hours = new Set<number>();
  for (const token of field.split(",")) {
    const range = /^(\d+)-(\d+)$/.exec(token);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start < 0 || end > 23 || start > end) return null;
      for (let h = start; h <= end; h++) hours.add(h);
    } else if (/^\d+$/.test(token)) {
      const h = Number(token);
      if (h < 0 || h > 23) return null;
      hours.add(h);
    } else {
      return null;
    }
  }
  return [...hours].sort((a, b) => a - b);
}

// Contiguous inclusive runs on the 24-hour circle. A run touching both midnight and 23:00 is merged
// into one wrap-around window ([18,8] for the off-hours complement) so it reads "6 PM to 8 AM".
function circularRuns(hours: number[]): Array<[number, number]> {
  if (hours.length === 0) return [];
  const runs: Array<[number, number]> = [];
  let start = hours[0];
  let prev = hours[0];
  for (let i = 1; i < hours.length; i++) {
    if (hours[i] === prev + 1) {
      prev = hours[i];
      continue;
    }
    runs.push([start, prev]);
    start = hours[i];
    prev = hours[i];
  }
  runs.push([start, prev]);

  if (runs.length > 1 && runs[0][0] === 0 && runs[runs.length - 1][1] === 23) {
    const wrap: [number, number] = [runs[runs.length - 1][0], runs[0][1]];
    return [wrap, ...runs.slice(1, -1)];
  }
  return runs;
}

function formatHour(h: number): string {
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  if (h < 12) return `${h} AM`;
  return `${h - 12} PM`;
}

function formatDayOfWeekSuffix(dayOfWeek: string): string {
  if (dayOfWeek === "*") return "";
  const days = parseDayOfWeek(dayOfWeek);
  if (days.length === 0 || days.length === 7) return "";
  if (days.length === 5 && !days.includes("Sat") && !days.includes("Sun")) {
    return " on weekdays";
  }
  return ` on ${days.join(", ")}`;
}

// Recognizes step forms (`*/N`) and their list-form equivalents (`0,30` → 30).
function parseMinuteStep(minute: string): number | null {
  const stepped = /^\*\/(\d+)$/.exec(minute);
  if (stepped) return Number(stepped[1]);

  if (!minute.includes(",")) return null;
  const parts = minute.split(",").map((p) => Number(p));
  if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 59)) return null;
  parts.sort((a, b) => a - b);
  if (parts[0] !== 0) return null;
  const step = parts[1] - parts[0];
  if (step <= 0) return null;
  for (let i = 1; i < parts.length; i++) {
    if (parts[i] - parts[i - 1] !== step) return null;
  }
  if (parts[parts.length - 1] + step <= 59) return null;
  return step;
}

function toDayIndex(value: string): number {
  const num = Number(value);
  if (!isNaN(num)) return num;
  return DAY_NAME_MAP[value.toLowerCase().slice(0, 3)] ?? -1;
}

function parseDayOfWeek(field: string): string[] {
  const days: string[] = [];
  for (const part of field.split(",")) {
    if (part.includes("-")) {
      const [start, end] = part.split("-").map(toDayIndex);
      for (let i = start; i <= end; i++) {
        if (DAY_NAMES[i]) days.push(DAY_NAMES[i]);
      }
    } else {
      const idx = toDayIndex(part);
      if (DAY_NAMES[idx]) days.push(DAY_NAMES[idx]);
    }
  }
  return days;
}
