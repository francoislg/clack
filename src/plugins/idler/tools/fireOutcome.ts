import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { ClackSdk } from "../../../plugins-sdk/sdk.js";
import { errorResult, textResult } from "../../../plugins-sdk/sdk.js";
import { loadConfig } from "../config.js";
import { recordAsyncTriggered, recordEmptyFire } from "../breaker.js";

export function createRecordFireOutcomeTool(sdk: ClackSdk) {
  return tool(
    "record_fire_outcome",
    "Record how this work fire ended, for the night circuit breaker. Use outcome 'empty' when no unit had fresh work (call once, immediately before ending via skip_response). Use outcome 'async-triggered' with an asyncKey (e.g. 'owner/repo#123') when the fire only posted an '@claude review this' trigger whose result you will read on a later fire — this keeps the breaker from tripping while your own overnight output is still pending. Do NOT call this on a productive fire (one that advanced a unit) — those reset the breaker automatically.",
    {
      outcome: z
        .enum(["empty", "async-triggered"])
        .describe(
          "'empty' = no fresh work this fire; 'async-triggered' = posted a review trigger, output pending.",
        ),
      asyncKey: z
        .string()
        .optional()
        .describe(
          "Stable trigger identity (e.g. 'owner/repo#123'). REQUIRED with 'async-triggered', omit for 'empty'.",
        ),
    },
    async (args) => {
      const config = await loadConfig(sdk);
      if (args.outcome === "async-triggered") {
        if (!args.asyncKey) {
          return errorResult("asyncKey is required when outcome is 'async-triggered'");
        }
        const state = await recordAsyncTriggered(sdk, config.workHours, new Date(), args.asyncKey);
        return textResult({ ok: true, outcome: args.outcome, pendingAsync: state.pendingAsync });
      }
      if (args.asyncKey) {
        return errorResult("asyncKey must not be supplied when outcome is 'empty'");
      }
      const state = await recordEmptyFire(sdk, config.workHours, new Date());
      return textResult({
        ok: true,
        outcome: args.outcome,
        consecutiveEmpty: state.consecutiveEmpty,
      });
    },
  );
}
