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

export function humanReadableSchedule(cronExpression: string, timezone: string): string {
  try {
    const interval = CronExpressionParser.parse(cronExpression, { tz: timezone });
    const next = interval.next().toDate();
    const timeStr = next.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
      timeZoneName: "short",
    });

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
  if (dayOfMonth !== "*" || dayOfWeek !== "*") return null;
  if (hour !== "*" && !/^\*\/\d+$/.test(hour)) return null;

  const hourStep = hour === "*" ? 1 : Number(hour.slice(2));
  const minuteSuffix = minute === "0" ? "" : ` at :${minute.padStart(2, "0")}`;

  if (hourStep > 1) return `Every ${hourStep} hours${minuteSuffix}`;

  const minuteStep = parseMinuteStep(minute);
  if (minute === "*") return "Every minute";
  if (minuteStep === 1) return "Every minute";
  if (minuteStep) return `Every ${minuteStep} minutes`;

  return `Every hour${minuteSuffix}`;
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
