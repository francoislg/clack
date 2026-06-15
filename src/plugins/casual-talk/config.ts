import { z } from "zod";
import type { ClackSdk } from "../sdk.js";
import type { CasualTalkConfig } from "./types.js";

const CONFIG_PATH = "config.json";

// Slack channel ID shape: C... (public), G... (private/legacy), D... (DM). Matches
// `isChannelId` in the core. We re-implement here so the plugin doesn't import from outside
// its folder. Plugin hard rules require this isolation.
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

const channelSchema = z.union([
  z.string().regex(SLACK_CHANNEL_ID, "channel ID must be C…/G…/D…"),
  z.object({
    id: z.string().regex(SLACK_CHANNEL_ID, "channel ID must be C…/G…/D…"),
    promptSuggestion: z.string().optional(),
  }),
]);

const workHoursSchema = z
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
    message: "workHours.start must be strictly less than workHours.end (no wrap-around)",
  });

export const casualTalkConfigSchema = z.object({
  enabled: z.boolean(),
  channels: z.array(channelSchema),
  workHours: workHoursSchema,
  expectedRate: z.enum(["hourly", "2-per-day", "daily", "2-per-week", "weekly"]),
  die: z.number().int().min(1).optional(),
  smallTalkTopics: z.array(z.string()),
  // .default keeps configs written before this field existed parsing cleanly.
  useBuiltinFallbackTopics: z.boolean().default(true),
});

export const DEFAULT_CONFIG: CasualTalkConfig = {
  enabled: false,
  channels: [],
  workHours: { start: 9, end: 17, tz: "UTC", days: [1, 2, 3, 4, 5] },
  expectedRate: "daily",
  smallTalkTopics: [],
  useBuiltinFallbackTopics: true,
};

/**
 * Load the plugin's config. On first boot (file absent), best-effort seeds the file with
 * `DEFAULT_CONFIG` and returns it (running on defaults if the seed write fails). On Zod parse
 * failure, throws — the caller (plugin init) catches and records via `sdk.error`.
 */
export async function loadConfig(sdk: ClackSdk): Promise<CasualTalkConfig> {
  const raw = await sdk.readFileOrSeed(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
  const parsed: unknown = JSON.parse(raw);
  return casualTalkConfigSchema.parse(parsed);
}

export async function saveConfig(sdk: ClackSdk, config: CasualTalkConfig): Promise<void> {
  // Re-validate before persisting so corrupted state can't be written out.
  const validated = casualTalkConfigSchema.parse(config);
  await sdk.writeFile(CONFIG_PATH, JSON.stringify(validated, null, 2));
}
