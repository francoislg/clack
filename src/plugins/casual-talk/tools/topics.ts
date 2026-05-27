import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { ClackSdk } from "../../sdk.js";
import { loadConfig, saveConfig } from "../config.js";
import { errorResult, textResult } from "../helpers.js";

export function createAddSmallTalkTopicTool(sdk: ClackSdk) {
  return tool(
    "add_small_talk_topic",
    "Add a fallback small-talk topic. The bot uses these as opener ideas when no candidate channel has active conversation. Idempotent — duplicates are skipped. Triggers a soft restart on success (no restart on duplicate).",
    {
      topic: z.string().describe("Topic label, e.g. 'weekend plans' or 'pop culture'"),
    },
    async (args) => {
      const config = await loadConfig(sdk);
      if (config.smallTalkTopics.includes(args.topic)) {
        return textResult({ ok: true, message: sdk.t("topic_already_present") });
      }
      await saveConfig(sdk, {
        ...config,
        smallTalkTopics: [...config.smallTalkTopics, args.topic],
      });
      sdk.requestSoftRestart("casual-talk: small-talk topic added");
      return textResult({ ok: true, message: sdk.t("topic_added", { topic: args.topic }) });
    },
  );
}

export function createRemoveSmallTalkTopicTool(sdk: ClackSdk) {
  return tool(
    "remove_small_talk_topic",
    "Remove a small-talk topic by exact match. Triggers a soft restart on success.",
    {
      topic: z.string().describe("Topic label to remove (exact match)"),
    },
    async (args) => {
      const config = await loadConfig(sdk);
      if (!config.smallTalkTopics.includes(args.topic)) {
        return errorResult(sdk.t("topic_not_found", { topic: args.topic }));
      }
      await saveConfig(sdk, {
        ...config,
        smallTalkTopics: config.smallTalkTopics.filter((t) => t !== args.topic),
      });
      sdk.requestSoftRestart("casual-talk: small-talk topic removed");
      return textResult({ ok: true, message: sdk.t("topic_removed", { topic: args.topic }) });
    },
  );
}
