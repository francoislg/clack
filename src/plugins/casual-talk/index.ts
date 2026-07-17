import type { ClackSdk, ClackPlugin, CronJobSpec } from "../sdk.js";
import { loadConfig } from "./config.js";
import { buildCronExpression, rateLabel, resolveDie } from "./heuristic.js";
import { buildPrompt } from "./prompt.js";
import { resolveFallbackTopics } from "./fallbackTopics.js";
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
import {
  createEnableTool,
  createDisableTool,
  createToggleBuiltinFallbackTopicsTool,
} from "./tools/toggle.js";

const MANAGEMENT_DESCRIPTION =
  "Manage the casual-talk plugin: candidate channels, small-talk topics, chattiness rate, work hours, and the enabled flag. Tools here mutate `data/plugins/casual-talk/config.json`; changes hot-reload and take effect on the next scheduled tick.";

// Forward jitter applied to every chatter fire so posts don't always land on the quarter-hour.
// Kept below the fixed 15-minute cadence (see buildCronExpression) so adjacent fires can't overlap.
const CHATTER_JITTER_MINUTES = 7;

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
  management.registerTool(
    "admin",
    createToggleBuiltinFallbackTopicsTool(sdk),
    "Toggling built-in fallback topics — {enabled}",
  );

  // The channel list, die, and topics are baked into the cron prompt at reconcile time,
  // so a config change is picked up by rebuilding the prompt and reconciling again — no
  // restart. On invalid config, record via `sdk.error` and leave the watcher running so a
  // corrected file recovers on its own.
  const reconcile = async (): Promise<void> => {
    let config;
    try {
      config = await loadConfig(sdk);
    } catch (err) {
      sdk.error(
        `Failed to load casual-talk config: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    const specs: CronJobSpec[] = [];
    if (config.enabled && config.channels.length > 0) {
      const die = resolveDie(config);
      const prompt = buildPrompt({
        die,
        rateLabel: rateLabel(config.expectedRate, die),
        channels: config.channels,
        smallTalkTopics: resolveFallbackTopics(config),
      });
      specs.push({
        specKey: "chatter",
        cronExpression: buildCronExpression(config.workHours),
        // No `channel` field — channelless dispatch. See `channelless-cron-jobs` capability.
        timezone: config.workHours.tz,
        prompt,
        name: "Casual chatter",
        submitResponseMode: "optional-post-to",
        requiredTools: ["mcp__clack__random_roll"],
        attachedTopics: ["casual-talk", "response-rendering"],
        jitterMinutes: CHATTER_JITTER_MINUTES,
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

  await reconcile();

  // Hot-reload on every config edit (tool writes via saveConfig, or external edits). No
  // soft restart: casual-talk's config only feeds the cron prompt, not tool gating or
  // instructions. See "Prefer hot-reload over soft-restart" in src/plugins/CLAUDE.md.
  sdk.watchFile("config.json", () => {
    reconcile().catch((err: unknown) => {
      sdk.error(
        `Failed to re-reconcile casual-talk after config change: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  });
};
