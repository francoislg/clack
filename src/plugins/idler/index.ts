import type { ClackSdk, ClackPlugin, CronJobSpec } from "../sdk.js";
import { isOperational, loadConfig } from "./config.js";
import { buildOffHoursCron, buildSummaryCron, type IdlerCronExpressions } from "./heuristic.js";
import { loadFetchInstructions } from "./fetchInstructions.js";
import { BEHAVIOR_INSTRUCTION } from "./instructions.js";
import { buildSyncPrompt } from "./prompts/sync.js";
import { buildWorkPrompt } from "./prompts/work.js";
import { buildSummaryPrompt } from "./prompts/summary.js";
import { en as idlerEn, fr as idlerFr } from "./i18n/strings.js";
import {
  createListTopIdeasTool,
  createReprioritizeTool,
  createUpsertIdeaTool,
} from "./tools/ideas.js";
import {
  createClearActivityTool,
  createReadActivityTool,
  createRecordActivityTool,
} from "./tools/activity.js";
import {
  createAddChannelTool,
  createAddRepoTool,
  createClearIdeaTool,
  createRemoveChannelTool,
  createRemoveRepoTool,
  createSetActiveHoursTool,
  createSetConfigTool,
  createViewIdeasTool,
} from "./tools/management.js";
import {
  createReadFetchInstructionsTool,
  createUpdateFetchInstructionsTool,
} from "./tools/instructionsAdmin.js";

const TOPIC = "idler";

const MANAGEMENT_DESCRIPTION =
  "Manage the idler plugin: enable/disable, active hours, reporting channel, repo allowlist, action caps, discovery channels, the work-unit ledger, and the admin-editable sourcing guidance (fetch-instructions.md). Edits hot-reload on the next fire.";

/** Emit one cron spec per non-null off-hours field (active-days + non-active-days), sharing a prompt. */
function pushOffHours(
  specs: CronJobSpec[],
  base: Omit<CronJobSpec, "specKey" | "cronExpression">,
  keyPrefix: string,
  crons: IdlerCronExpressions,
): void {
  specs.push({
    ...base,
    specKey: `${keyPrefix}-active-days`,
    cronExpression: crons.offHoursActiveDays,
  });
  if (crons.offHoursNonActiveDays !== null) {
    specs.push({
      ...base,
      specKey: `${keyPrefix}-off-days`,
      cronExpression: crons.offHoursNonActiveDays,
    });
  }
}

export const idlerPlugin: ClackPlugin = async (sdk: ClackSdk) => {
  if (!sdk.capabilities.crons) {
    sdk.error("Idler requires the cron scheduler. Enable it via `config.cron.enabled: true`.");
    return;
  }

  sdk.registerDictionary({ en: idlerEn, fr: idlerFr });

  // Behavior/contract — pre-attached to every idler fire via attachedTopics: [TOPIC].
  sdk.addTopicInstruction("dev", TOPIC, "behavior", BEHAVIOR_INSTRUCTION);

  // Ledger + activity tools live on the always-on default server so the cron sessions reach them
  // without attach_integration. Admin-gated; the system cron actor passes.
  sdk.registerTool("admin", createListTopIdeasTool(sdk), "Listing idler ideas");
  sdk.registerTool("admin", createUpsertIdeaTool(sdk), "Updating idler idea — {key}");
  sdk.registerTool("admin", createReprioritizeTool(sdk), "Reprioritizing idler idea — {key}");
  sdk.registerTool("admin", createRecordActivityTool(sdk), "Recording idler activity — {kind}");
  sdk.registerTool("admin", createReadActivityTool(sdk), "Reading idler activity");
  sdk.registerTool("admin", createClearActivityTool(sdk), "Clearing idler activity");

  // Admin management surface — on demand via attach_integration("idler:management").
  const management = sdk.registerMcpServer("management", {
    autoload: false,
    description: MANAGEMENT_DESCRIPTION,
  });
  management.addTopicInstruction("admin", "manage", MANAGEMENT_DESCRIPTION);
  management.registerTool("admin", createSetConfigTool(sdk), "Updating idler config");
  management.registerTool("admin", createSetActiveHoursTool(sdk), "Setting idler active hours");
  management.registerTool("admin", createAddRepoTool(sdk), "Adding idler repo — {repo}");
  management.registerTool("admin", createRemoveRepoTool(sdk), "Removing idler repo — {repo}");
  management.registerTool("admin", createAddChannelTool(sdk), "Adding idler channel — {id}");
  management.registerTool("admin", createRemoveChannelTool(sdk), "Removing idler channel — {id}");
  management.registerTool("admin", createViewIdeasTool(sdk), "Viewing idler ledger");
  management.registerTool("admin", createClearIdeaTool(sdk), "Clearing idler idea — {key}");
  management.registerTool(
    "admin",
    createReadFetchInstructionsTool(sdk),
    "Reading idler fetch instructions",
  );
  management.registerTool(
    "admin",
    createUpdateFetchInstructionsTool(sdk),
    "Updating idler fetch instructions",
  );

  const reconcile = async (): Promise<void> => {
    let config;
    try {
      config = await loadConfig(sdk);
    } catch (err) {
      sdk.error(`Failed to load idler config: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    if (!isOperational(config) || !config.reportingChannel) {
      await sdk.reconcileCronJobs(TOPIC, []);
      return;
    }

    const fetchInstructions = await loadFetchInstructions(sdk);
    const tz = config.activeHours.tz;
    const specs: CronJobSpec[] = [];

    pushOffHours(
      specs,
      {
        prompt: buildSyncPrompt(config, fetchInstructions),
        timezone: tz,
        name: "Idler sync",
        submitResponseMode: "skipped",
        attachedTopics: [TOPIC],
      },
      "sync",
      buildOffHoursCron(config.activeHours, "0"),
    );

    pushOffHours(
      specs,
      {
        channel: config.reportingChannel,
        prompt: buildWorkPrompt(config, fetchInstructions),
        timezone: tz,
        name: "Idler work",
        submitResponseMode: "optional",
        attachedTopics: [TOPIC],
      },
      "work",
      buildOffHoursCron(config.activeHours, "*/15"),
    );

    specs.push({
      specKey: "summary",
      cronExpression: buildSummaryCron(
        config.activeHours,
        config.summaryHour ?? config.activeHours.start,
      ),
      channel: config.reportingChannel,
      prompt: buildSummaryPrompt(),
      timezone: tz,
      name: "Idler summary",
      attachedTopics: [TOPIC],
    });

    await sdk.reconcileCronJobs(TOPIC, specs);
    sdk.logger.info(`reconciled ${specs.length} idler cron specs`);
  };

  await reconcile();

  const onChange = (): void => {
    reconcile().catch((err: unknown) => {
      sdk.error(
        `Failed to re-reconcile idler: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  };
  sdk.watchFile("config.json", onChange);
  sdk.watchFile("fetch-instructions.md", onChange);
};
