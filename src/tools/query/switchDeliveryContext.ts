import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { DeliveryControl } from "../types.js";
import { textResult } from "../helpers.js";

/**
 * `switch_delivery_context` — change the in-flight delivery mode for the CURRENT turn.
 * Backed by the orchestrator's `DeliveryControl`; it swaps the active delivery handler now AND
 * persists the new mode as the thread default. Offered only on interactive turns (a live
 * streaming surface to switch); absent in channelless cron / worker contexts.
 */
export function createSwitchDeliveryContextTool(deliveryControl: DeliveryControl) {
  return tool(
    "switch_delivery_context",
    "Switch how THIS thread delivers — immediately, on the current turn. `streamer` shows the " +
      "live thinking / tool-progress card; `invisible` suppresses it so replies just appear " +
      "(natural for casual chatter). Unlike submit_response.default_delivery_mode (which only " +
      "takes effect next turn), this takes effect now: call it the moment a casual thread turns " +
      "into real work (→ `streamer`) or work winds back down to banter (→ `invisible`). The new " +
      "mode also becomes the thread default for future turns. No-op if already in that mode, or " +
      "once the final response has been delivered.",
    {
      mode: z
        .enum(["streamer", "invisible"])
        .describe("The delivery mode to switch to for this thread, effective immediately."),
    },
    async (args) => {
      await deliveryControl.switchTo(args.mode);
      return textResult({ success: true, mode: args.mode });
    },
  );
}
