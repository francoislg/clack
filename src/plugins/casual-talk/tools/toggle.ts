import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { ClackSdk } from "../../sdk.js";
import { loadConfig, saveConfig } from "../config.js";
import { textResult } from "../helpers.js";

export function createEnableTool(sdk: ClackSdk) {
  return tool(
    "enable",
    "Enable casual-talk. The cron spec is reconciled and the bot starts rolling on every tick within work hours. Idempotent — calling on an already-enabled plugin is a no-op (no soft restart).",
    {},
    async () => {
      const config = await loadConfig(sdk);
      if (config.enabled) {
        return textResult({ ok: true, message: sdk.t("already_enabled") });
      }
      await saveConfig(sdk, { ...config, enabled: true });
      sdk.requestSoftRestart("casual-talk: enabled");
      return textResult({ ok: true, message: sdk.t("enabled") });
    },
  );
}

export function createDisableTool(sdk: ClackSdk) {
  return tool(
    "disable",
    "Disable casual-talk. The cron spec is removed on next reconcile; the bot stops rolling. Idempotent — calling on an already-disabled plugin is a no-op (no soft restart).",
    {},
    async () => {
      const config = await loadConfig(sdk);
      if (!config.enabled) {
        return textResult({ ok: true, message: sdk.t("already_disabled") });
      }
      await saveConfig(sdk, { ...config, enabled: false });
      sdk.requestSoftRestart("casual-talk: disabled");
      return textResult({ ok: true, message: sdk.t("disabled") });
    },
  );
}

export function createToggleBuiltinFallbackTopicsTool(sdk: ClackSdk) {
  return tool(
    "toggle_builtin_fallback_topics",
    "Turn the plugin's built-in fallback small-talk topics on or off. When on (the default), a curated built-in topic list is unioned with any configured `smallTalkTopics` and used to open fresh small talk when no candidate channel has an active conversation. When off, only the configured `smallTalkTopics` are used — with none configured, the bot never opens fresh small talk and only chips into already-active conversations. Idempotent — a no-op (no soft restart) when the flag already matches the requested value.",
    {
      enabled: z.boolean().describe("true to use built-in fallback topics, false to disable them"),
    },
    async (args) => {
      const config = await loadConfig(sdk);
      if (config.useBuiltinFallbackTopics === args.enabled) {
        return textResult({
          ok: true,
          message: sdk.t(
            args.enabled ? "builtin_fallback_already_on" : "builtin_fallback_already_off",
          ),
        });
      }
      await saveConfig(sdk, { ...config, useBuiltinFallbackTopics: args.enabled });
      sdk.requestSoftRestart("casual-talk: built-in fallback topics toggled");
      return textResult({
        ok: true,
        message: sdk.t(args.enabled ? "builtin_fallback_on" : "builtin_fallback_off"),
      });
    },
  );
}
