import { z } from "zod";
import type { ClackSdk } from "../sdk.js";
import type { IdlerConfig } from "./types.js";

const CONFIG_PATH = "config.json";

const SLACK_CHANNEL_ID = /^[CGD][A-Z0-9]+$/;

function isValidTimezone(tz: string): boolean {
  if (typeof tz !== "string" || tz.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const activeHoursSchema = z
  .object({
    start: z.number().int().min(0).max(23),
    end: z.number().int().min(1).max(24),
    tz: z
      .string()
      .min(1, "tz must be a non-empty IANA timezone string")
      .refine(isValidTimezone, "tz must be a valid IANA timezone (e.g. 'America/Montreal')"),
    days: z.array(z.number().int().min(0).max(6)).min(1, "days must be non-empty"),
  })
  .refine((wh) => wh.start < wh.end, {
    message: "activeHours.start must be strictly less than activeHours.end (no wrap-around)",
  });

const sourcesSchema = z.object({
  channels: z.array(z.string().regex(SLACK_CHANNEL_ID, "channel ID must be C…/G…/D…")).default([]),
  tracker: z.boolean().default(false),
  ownPrs: z.boolean().default(true),
});

export const idlerConfigSchema = z.object({
  enabled: z.boolean(),
  activeHours: activeHoursSchema,
  repoAllowlist: z.array(z.string().min(1)).default([]),
  reportingChannel: z.string().regex(SLACK_CHANNEL_ID, "channel ID must be C…/G…/D…").optional(),
  summaryHour: z.number().int().min(0).max(23).optional(),
  maxActionsPerFire: z.number().int().min(1).max(20).default(1),
  maxActionsPerNight: z.number().int().min(1).max(100).default(5),
  sources: sourcesSchema.default({ channels: [], tracker: false, ownPrs: true }),
});

export const DEFAULT_CONFIG: IdlerConfig = {
  enabled: false,
  activeHours: { start: 9, end: 18, tz: "UTC", days: [1, 2, 3, 4, 5] },
  repoAllowlist: [],
  maxActionsPerFire: 1,
  maxActionsPerNight: 5,
  sources: { channels: [], tracker: false, ownPrs: true },
};

/**
 * Fail-fast loader: seeds `DEFAULT_CONFIG` on first boot, throws on Zod failure so the
 * caller (plugin init) records it via `sdk.error`. Boot config follows the fail-fast
 * philosophy (src/plugins/CLAUDE.md / project conventions), unlike the graceful ledger reader.
 */
export async function loadConfig(sdk: ClackSdk): Promise<IdlerConfig> {
  const raw = await sdk.readFile(CONFIG_PATH);
  if (raw === null) {
    await sdk.writeFile(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return DEFAULT_CONFIG;
  }
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
  return config.enabled && config.repoAllowlist.length > 0 && Boolean(config.reportingChannel);
}
