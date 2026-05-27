import type { ClackSdk, ClackPlugin, CronJobSpec } from "../sdk.js";
import { loadConfig } from "./config.js";
import { buildCronExpression, rateLabel, resolveDie } from "./heuristic.js";
import { buildPrompt } from "./prompt.js";
import { PERSONA_CONTENT } from "./persona.js";
import { en as casualTalkEn, fr as casualTalkFr } from "./i18n/strings.js";
import { createSetConfigTool } from "./tools/setConfig.js";
import {
  createAddChannelTool,
  createRemoveChannelTool,
  createSetChannelPromptSuggestionTool,
} from "./tools/channels.js";
import { createAddSmallTalkTopicTool, createRemoveSmallTalkTopicTool } from "./tools/topics.js";
import { createSetExpectedRateTool } from "./tools/rate.js";
import { createSetWorkHoursTool } from "./tools/workHours.js";
import { createEnableTool, createDisableTool } from "./tools/toggle.js";

const MANAGEMENT_DESCRIPTION =
  "Manage the casual-talk plugin: candidate channels, small-talk topics, chattiness rate, work hours, and the enabled flag. Tools here mutate `data/plugins/casual-talk/config.json` and trigger a soft restart so changes take effect immediately.";

export const casualTalkPlugin: ClackPlugin = async (sdk: ClackSdk) => {
  // Casual-talk is a cron-driven plugin. Without the scheduler tick loop, none of its
  // tools or instructions are useful. Refuse to load with a clear reason so admins see
  // it in the Home Tab plugin status banner.
  if (!sdk.capabilities.crons) {
    sdk.error(
      "Casual-talk requires the cron scheduler. Enable it via `config.cron.enabled: true`.",
    );
    return;
  }

  sdk.registerDictionary({ en: casualTalkEn, fr: casualTalkFr });

  // Persona pre-attached to every casual-talk fire. Admins override at
  // `data/configuration/user/topics/casual-talk/casual-talk__persona.md`.
  sdk.addTopicInstruction("user", "casual-talk", "persona", PERSONA_CONTENT);

  // On-demand management server — all config-mutation tools live here. Admins call
  // `attach_integration("casual-talk:management")` to reveal them.
  const management = sdk.registerMcpServer("management", {
    autoload: false,
    description: MANAGEMENT_DESCRIPTION,
  });

  management.registerTool("admin", createSetConfigTool(sdk), "Replacing casual-talk config");
  management.registerTool("admin", createAddChannelTool(sdk), "Adding casual-talk channel — {id}");
  management.registerTool(
    "admin",
    createRemoveChannelTool(sdk),
    "Removing casual-talk channel — {id}",
  );
  management.registerTool(
    "admin",
    createSetChannelPromptSuggestionTool(sdk),
    "Updating channel prompt — {id}",
  );
  management.registerTool(
    "admin",
    createAddSmallTalkTopicTool(sdk),
    "Adding small-talk topic — {topic}",
  );
  management.registerTool(
    "admin",
    createRemoveSmallTalkTopicTool(sdk),
    "Removing small-talk topic — {topic}",
  );
  management.registerTool("admin", createSetExpectedRateTool(sdk), "Setting expected rate");
  management.registerTool("admin", createSetWorkHoursTool(sdk), "Updating casual-talk work hours");
  management.registerTool("admin", createEnableTool(sdk), "Enabling casual-talk");
  management.registerTool("admin", createDisableTool(sdk), "Disabling casual-talk");

  // Load config and reconcile the cron spec. If config is invalid, `loadConfig` throws
  // and the harness catches it via the synthesizeErrorResult path — the plugin shows up
  // on the Home Tab with its error banner.
  let config;
  try {
    config = await loadConfig(sdk);
  } catch (err) {
    sdk.error(
      `Failed to load casual-talk config: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  // Build the one cron spec, or pass [] to clear any prior spec when disabled or empty.
  const specs: CronJobSpec[] = [];
  if (config.enabled && config.channels.length > 0) {
    const die = resolveDie(config);
    const prompt = buildPrompt({
      die,
      rateLabel: rateLabel(config.expectedRate, die),
      channels: config.channels,
      smallTalkTopics: config.smallTalkTopics,
    });
    specs.push({
      specKey: "chatter",
      cronExpression: buildCronExpression(config.workHours),
      // No `channel` field — channelless dispatch. See `channelless-cron-jobs` capability.
      timezone: config.workHours.tz,
      prompt,
      name: "Casual chatter",
      submitResponseMode: "skipped",
      requiredTools: ["mcp__clack__random_roll"],
      attachedTopics: ["casual-talk"],
    });
  } else if (config.enabled && config.channels.length === 0) {
    sdk.logger.info("enabled but no channels configured — no cron spec reconciled");
  }

  await sdk.reconcileCronJobs("casual-talk", specs);
  if (specs.length > 0) {
    sdk.logger.info(
      `reconciled 1 cron spec (rate: ${rateLabel(config.expectedRate, resolveDie(config))})`,
    );
  }
};
