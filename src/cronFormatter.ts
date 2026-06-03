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
  const rangeMatch = /^(\d+)-(\d+)$/.exec(hour);
  if (rangeMatch) {
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    if (start >= 0 && end <= 23 && start <= end) {
      return { step: 1, range: [start, end] };
    }
  }
  return null;
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
