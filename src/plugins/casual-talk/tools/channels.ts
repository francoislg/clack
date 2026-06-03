import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { ClackSdk } from "../../sdk.js";
import { loadConfig, saveConfig } from "../config.js";
import { errorResult, textResult } from "../helpers.js";
import { normalizeChannel, type CasualTalkChannel } from "../types.js";

function findChannelIndex(channels: CasualTalkChannel[], id: string): number {
  return channels.findIndex((entry) => normalizeChannel(entry).id === id);
}

export function createAddChannelTool(sdk: ClackSdk) {
  return tool(
    "add_channel",
    "Add a Slack channel to the casual-talk candidate list. The bot will consider this channel when it rolls a hit. Optionally include a promptSuggestion to give Claude a per-channel character hint (e.g. 'memes only — keep it visual'). If the channel is already in the list, the prompt suggestion is updated. Takes effect on the next scheduled tick via config hot-reload.",
    {
      id: z.string().describe("Slack channel ID (C…, G…, or D…)"),
      promptSuggestion: z
        .string()
        .optional()
        .describe(
          "Per-channel character hint to help Claude tailor its post. Optional — omit for channels where the channel name and recent messages are enough context.",
        ),
    },
    async (args) => {
      const config = await loadConfig(sdk);
      const existingIdx = findChannelIndex(config.channels, args.id);
      if (existingIdx >= 0) {
        const updated: CasualTalkChannel = args.promptSuggestion
          ? { id: args.id, promptSuggestion: args.promptSuggestion }
          : args.id;
        const next = [...config.channels];
        next[existingIdx] = updated;
        await saveConfig(sdk, { ...config, channels: next });
        return textResult({ ok: true, message: sdk.t("channel_already_present", { id: args.id }) });
      }
      const newEntry: CasualTalkChannel = args.promptSuggestion
        ? { id: args.id, promptSuggestion: args.promptSuggestion }
        : args.id;
      await saveConfig(sdk, { ...config, channels: [...config.channels, newEntry] });
      return textResult({ ok: true, message: sdk.t("channel_added", { id: args.id }) });
    },
  );
}

export function createRemoveChannelTool(sdk: ClackSdk) {
  return tool(
    "remove_channel",
    "Remove a Slack channel from the casual-talk candidate list. Takes effect on the next scheduled tick via config hot-reload.",
    {
      id: z.string().describe("Slack channel ID to remove"),
    },
    async (args) => {
      const config = await loadConfig(sdk);
      const idx = findChannelIndex(config.channels, args.id);
      if (idx < 0) {
        return errorResult(sdk.t("channel_not_found", { id: args.id }));
      }
      const next = config.channels.filter((_, i) => i !== idx);
      await saveConfig(sdk, { ...config, channels: next });
      return textResult({ ok: true, message: sdk.t("channel_removed", { id: args.id }) });
    },
  );
}

export function createSetChannelPromptSuggestionTool(sdk: ClackSdk) {
  return tool(
    "set_channel_prompt_suggestion",
    "Update or clear the per-channel prompt suggestion. Pass an empty string to clear (the entry reverts to a bare channel ID). Takes effect on the next scheduled tick via config hot-reload.",
    {
      id: z.string().describe("Slack channel ID"),
      promptSuggestion: z
        .string()
        .describe("New suggestion text. Empty string clears the existing suggestion."),
    },
    async (args) => {
      const config = await loadConfig(sdk);
      const idx = findChannelIndex(config.channels, args.id);
      if (idx < 0) {
        return errorResult(sdk.t("channel_not_found", { id: args.id }));
      }
      const next = [...config.channels];
      next[idx] =
        args.promptSuggestion.length > 0
          ? { id: args.id, promptSuggestion: args.promptSuggestion }
          : args.id;
      await saveConfig(sdk, { ...config, channels: next });
      const msgKey =
        args.promptSuggestion.length > 0 ? "prompt_suggestion_set" : "prompt_suggestion_cleared";
      return textResult({ ok: true, message: sdk.t(msgKey, { id: args.id }) });
    },
  );
}
