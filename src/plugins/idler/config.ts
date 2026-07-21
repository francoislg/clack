import { z } from "zod";
import type { ClackSdk } from "../../plugins-sdk/sdk.js";
import type { IdlerConfig } from "./types.js";

const CONFIG_PATH = "config.json";

export const SLACK_CHANNEL_ID = /^[CGD][A-Z0-9]+$/;

function isValidTimezone(tz: string): boolean {
  if (typeof tz !== "string" || tz.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const windowSchema = z
  .object({
    start: z.number().int().min(0).max(23),
    end: z.number().int().min(1).max(24),
    tz: z
      .string()
      .min(1, "tz must be a non-empty IANA timezone string")
      .refine(isValidTimezone, "tz must be a valid IANA timezone (e.g. 'America/Montreal')"),
    days: z.array(z.number().int().min(0).max(6)).min(1, "days must be non-empty"),
  })
  .refine((w) => w.start !== w.end, {
    message: "start and end must differ (use start > end for an overnight window)",
  });

const sourcesSchema = z.object({
  channels: z.array(z.string().regex(SLACK_CHANNEL_ID, "channel ID must be C…/G…/D…")).default([]),
  tracker: z.boolean().default(false),
  ownPrs: z.boolean().default(true),
  scanMemory: z.boolean().default(true),
});

const reportingSchema = z.object({
  channel: z.string().regex(SLACK_CHANNEL_ID, "channel ID must be C…/G…/D…").optional(),
  tickUpdates: z.enum(["none", "optional"]).default("none"),
  summary: z.boolean().default(true),
  summaryHour: z.number().int().min(0).max(23).optional(),
});

/** Divisors of 60 in [5, 60] — the `workEveryMinutes` values whose cron minute field tiles each hour evenly. */
export const WORK_EVERY_MINUTES_VALUES = [5, 6, 10, 12, 15, 20, 30, 60] as const;

const baseConfigSchema = z.object({
  enabled: z.boolean(),
  workHours: windowSchema,
  syncHours: windowSchema.optional(),
  syncEveryHours: z.number().int().min(1).max(12).default(2),
  workEveryMinutes: z
    .number()
    .int()
    .min(5)
    .max(60)
    .refine((n) => 60 % n === 0, {
      message: `workEveryMinutes must be a divisor of 60 in [5, 60] (${WORK_EVERY_MINUTES_VALUES.join(", ")})`,
    })
    .default(30),
  repoAllowlist: z.array(z.string().min(1)).default([]),
  reporting: reportingSchema.default({ tickUpdates: "none", summary: true }),
  maxActionsPerFire: z.number().int().min(1).max(20).default(1),
  maxActionsPerNight: z.number().int().min(1).max(100).default(5),
  sources: sourcesSchema.default({
    channels: [],
    tracker: false,
    ownPrs: true,
    scanMemory: true,
  }),
});

/**
 * Lifts legacy top-level `reportingChannel`/`summaryHour` into the `reporting` block when no
 * block is present, so config files written before the block was introduced keep working. An
 * explicit `reporting` block always wins — the legacy fields are ignored when it is present.
 */
export const idlerConfigSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || "reporting" in raw) {
    return raw;
  }
  const legacy = raw as { reportingChannel?: unknown; summaryHour?: unknown };
  const reporting: { channel?: string; summaryHour?: number } = {};
  if (typeof legacy.reportingChannel === "string") reporting.channel = legacy.reportingChannel;
  if (typeof legacy.summaryHour === "number") reporting.summaryHour = legacy.summaryHour;
  return { ...raw, reporting };
}, baseConfigSchema);

export const DEFAULT_CONFIG: IdlerConfig = {
  enabled: false,
  workHours: { start: 18, end: 9, tz: "UTC", days: [1, 2, 3, 4, 5] },
  syncEveryHours: 2,
  workEveryMinutes: 30,
  repoAllowlist: [],
  reporting: { tickUpdates: "none", summary: true },
  maxActionsPerFire: 1,
  maxActionsPerNight: 5,
  sources: { channels: [], tracker: false, ownPrs: true, scanMemory: true },
};

/**
 * Fail-fast loader: best-effort seeds `DEFAULT_CONFIG` on first boot (running on defaults if the
 * seed write fails), throws on Zod failure so the caller (plugin init) records it via `sdk.error`.
 * Boot config follows the fail-fast philosophy (src/plugins/CLAUDE.md / project conventions),
 * unlike the graceful ledger reader.
 */
export async function loadConfig(sdk: ClackSdk): Promise<IdlerConfig> {
  const raw = await sdk.readFileOrSeed(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
  const parsed: unknown = JSON.parse(raw);
  return idlerConfigSchema.parse(parsed);
}

export async function saveConfig(sdk: ClackSdk, config: IdlerConfig): Promise<void> {
  const validated = idlerConfigSchema.parse(config);
  await sdk.writeFile(CONFIG_PATH, JSON.stringify(validated, null, 2));
}

/**
 * True when the plugin should reconcile its cron specs: enabled, at least one allowlisted repo, and
 * a reporting channel (the work/summary tasks post change progress + the digest there).
 */
export function isOperational(config: IdlerConfig): boolean {
  return config.enabled && config.repoAllowlist.length > 0 && Boolean(config.reporting.channel);
}
