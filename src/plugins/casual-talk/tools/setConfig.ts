import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { ClackSdk } from "../../sdk.js";
import { casualTalkConfigSchema, saveConfig } from "../config.js";
import { errorResult, textResult } from "../helpers.js";

const channelInputSchema = z.union([
  z.string(),
  z.object({
    id: z.string(),
    promptSuggestion: z.string().optional(),
  }),
]);

const workHoursInputSchema = z.object({
  start: z.number().int(),
  end: z.number().int(),
  tz: z.string(),
  days: z.array(z.number().int()),
});

export function createSetConfigTool(sdk: ClackSdk) {
  return tool(
    "set_casual_talk_config",
    "Replace the entire casual-talk plugin config. Use this only when an admin wants to overwrite every field at once; for targeted changes, prefer the more specific tools (add_channel, set_expected_rate, etc.). Triggers a soft restart so the new config takes effect immediately.",
    {
      enabled: z.boolean(),
      channels: z.array(channelInputSchema),
      workHours: workHoursInputSchema,
      expectedRate: z.enum(["hourly", "2-per-day", "daily", "2-per-week", "weekly"]),
      die: z.number().int().optional(),
      smallTalkTopics: z.array(z.string()),
      useBuiltinFallbackTopics: z.boolean().optional(),
    },
    async (args) => {
      const result = casualTalkConfigSchema.safeParse(args);
      if (!result.success) {
        return errorResult(sdk.t("validation_failed", { message: result.error.message }));
      }
      await saveConfig(sdk, result.data);
      sdk.requestSoftRestart("casual-talk: full config replaced");
      return textResult({ ok: true, message: sdk.t("config_replaced") });
    },
  );
}
