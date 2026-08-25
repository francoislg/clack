import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { ClackSdk } from "../../../plugins-sdk/sdk.js";
import { textResult } from "../../../plugins-sdk/sdk.js";
import { loadConfig } from "../config.js";
import { recordEmptyFire } from "../breaker.js";

export function createRecordFireOutcomeTool(sdk: ClackSdk) {
  return tool(
    "record_fire_outcome",
    "Record that this work fire ended with no fresh work. Call this exactly once, immediately before ending an empty fire via skip_response. Do NOT call it on a productive fire (one that advanced a unit) — productive fires are detected automatically.",
    {
      outcome: z
        .enum(["empty"])
        .describe("The fire's outcome. 'empty' = no unit had fresh work this fire."),
    },
    async (args) => {
      const config = await loadConfig(sdk);
      const state = await recordEmptyFire(sdk, config.workHours, new Date());
      return textResult({
        ok: true,
        outcome: args.outcome,
        consecutiveEmpty: state.consecutiveEmpty,
      });
    },
  );
}
