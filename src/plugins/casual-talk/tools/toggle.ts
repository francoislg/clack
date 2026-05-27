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
