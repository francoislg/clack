import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { ClackSdk } from "../../sdk.js";
import { loadConfig, saveConfig } from "../config.js";
import { errorResult, textResult } from "../helpers.js";

export function createSetExpectedRateTool(sdk: ClackSdk) {
  return tool(
    "set_expected_rate",
    "Set the expected chattiness — either a named rate ('hourly', '2-per-day', 'daily', '2-per-week', 'weekly') OR an explicit die size. Note: the rate is TOTAL across all configured channels, NOT per-channel. With expectedRate 'daily' and 5 channels, you'd see ~1 post/day spread across the 5, i.e. 1 per channel every 5 days. Triggers a soft restart on success.",
    {
      rate: z
        .enum(["hourly", "2-per-day", "daily", "2-per-week", "weekly"])
        .optional()
        .describe("Named expected rate. Mutually exclusive with `die`."),
      die: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          "Explicit roll-die size — Claude rolls 1..die per tick, posts only on 1. Wins over `rate` when both are provided.",
        ),
    },
    async (args) => {
      if (args.rate === undefined && args.die === undefined) {
        return errorResult("set_expected_rate requires either `rate` or `die`.");
      }
      const config = await loadConfig(sdk);
      if (args.die !== undefined) {
        await saveConfig(sdk, { ...config, die: args.die });
        sdk.requestSoftRestart("casual-talk: die override set");
        return textResult({ ok: true, message: sdk.t("rate_set_die", { die: args.die }) });
      }
      // args.rate is defined here
      const nextConfig = { ...config, expectedRate: args.rate!, die: undefined };
      await saveConfig(sdk, nextConfig);
      sdk.requestSoftRestart("casual-talk: expected rate set");
      return textResult({ ok: true, message: sdk.t("rate_set_named", { rate: args.rate! }) });
    },
  );
}
