import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { ClackSdk } from "../../../plugins-sdk/sdk.js";
import { casualTalkConfigSchema, loadConfig, saveConfig } from "../config.js";
import { errorResult, textResult } from "../../../plugins-sdk/sdk.js";

export function createSetWorkHoursTool(sdk: ClackSdk) {
  return tool(
    "set_work_hours",
    "Set the work-hours window during which casual-talk may fire. start is inclusive (e.g. 9 = first fire at 9:00), end is exclusive (e.g. 16 = last fire at 15:45 on the 15-minute cadence). days are JS day-of-week numbers (0=Sun, 6=Sat). Takes effect on the next scheduled tick via config hot-reload.",
    {
      start: z.number().int().min(0).max(23).describe("Inclusive start hour (0-23)"),
      end: z.number().int().min(1).max(24).describe("Exclusive end hour (1-24). Must be > start."),
      tz: z.string().describe("IANA timezone string (e.g. 'America/Montreal', 'UTC')"),
      days: z
        .array(z.number().int().min(0).max(6))
        .min(1)
        .describe("JS day-of-week numbers (0=Sun, 6=Sat), non-empty"),
    },
    async (args) => {
      const config = await loadConfig(sdk);
      const nextConfig = {
        ...config,
        workHours: { start: args.start, end: args.end, tz: args.tz, days: args.days },
      };
      const result = casualTalkConfigSchema.safeParse(nextConfig);
      if (!result.success) {
        return errorResult(sdk.t("validation_failed", { message: result.error.message }));
      }
      await saveConfig(sdk, result.data);
      return textResult({
        ok: true,
        message: sdk.t("work_hours_set", {
          start: args.start,
          end: args.end,
          tz: args.tz,
          days: args.days.join(","),
        }),
      });
    },
  );
}
