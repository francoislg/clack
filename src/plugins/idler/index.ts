import type { ClackSdk, ClackPlugin, CronJobSpec } from "../../plugins-sdk/sdk.js";
import { isOperational, loadConfig } from "./config.js";
import {
  buildDeepSyncCron,
  buildDiscoverySyncCron,
  buildLightSyncCron,
  buildSummaryCron,
  buildWindowCron,
  syncSchedule,
} from "./heuristic.js";
import { loadFetchInstructions } from "./fetchInstructions.js";
import { BEHAVIOR_INSTRUCTION } from "./instructions.js";
import {
  buildSyncDeepPrompt,
  buildSyncDiscoveryPrompt,
  buildSyncLightPrompt,
  buildSyncMaintenancePrompt,
} from "./prompts/sync.js";
import { buildWorkPrompt } from "./prompts/work.js";
import { buildSummaryPrompt } from "./prompts/summary.js";
import { en as idlerEn, fr as idlerFr } from "./i18n/strings.js";
import { parseSlot } from "./slice.js";
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
  createSetWorkHoursTool,
  createSetSyncHoursTool,
  createSetConfigTool,
  createViewIdeasTool,
} from "./tools/management.js";
import {
  createReadFetchInstructionsTool,
  createUpdateFetchInstructionsTool,
} from "./tools/instructionsAdmin.js";

const TOPIC = "idler";

const MANAGEMENT_DESCRIPTION =
  "Manage the idler plugin: enable/disable, work hours, sync hours, reporting channel, repo allowlist, action caps, discovery channels, the work-unit ledger, and the admin-editable sourcing guidance (fetch-instructions.md). Edits hot-reload on the next fire.";

export const idlerPlugin: ClackPlugin = async (sdk: ClackSdk) => {
  if (!sdk.capabilities.crons) {
    sdk.error("Idler requires the cron scheduler. Enable it via `config.cron.enabled: true`.");
    return;
  }

  sdk.registerDictionary({ en: idlerEn, fr: idlerFr });

  // Protect in-flight work: the daily memory review must not prune an entry the idler still
  // considers open (e.g. an open PR). Closed units (open:false) are eligible for expiry.
  sdk.memory.onBeforeExpire((entry) => {
    const slot = parseSlot(entry.plugins?.idler);
    return slot?.open === true ? { vetoed: true } : { vetoed: false };
  });

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
  management.registerTool("admin", createSetWorkHoursTool(sdk), "Setting idler work hours");
  management.registerTool("admin", createSetSyncHoursTool(sdk), "Setting idler sync hours");
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

    const channel = config.reporting.channel;
    if (!isOperational(config) || !channel) {
      await sdk.reconcileCronJobs(TOPIC, []);
      return;
    }

    const fetchInstructions = await loadFetchInstructions(sdk);
    const tz = config.workHours.tz;
    const specs: CronJobSpec[] = [];

    const schedule = syncSchedule(config.workHours, config.syncHours);
    const syncTz = config.syncHours?.tz ?? tz;

    // Split layout: a separate discovery fire feeds the ledger one slot before the anchor, and
    // the anchor fire runs maintenance only. No eligible discovery hour → combined fallback.
    const discoveryCron = buildDiscoverySyncCron(schedule, "45", config.syncEveryHours);

    const deepSyncCron = buildDeepSyncCron(schedule, "45");
    if (deepSyncCron) {
      specs.push({
        specKey: "sync",
        cronExpression: deepSyncCron,
        prompt: discoveryCron
          ? buildSyncMaintenancePrompt(config)
          : buildSyncDeepPrompt(config, fetchInstructions),
        timezone: syncTz,
        name: "Idler deep sync",
        submitResponseMode: "skipped",
        attachedTopics: [TOPIC],
      });
    }

    if (discoveryCron) {
      specs.push({
        specKey: "sync-discovery",
        cronExpression: discoveryCron,
        prompt: buildSyncDiscoveryPrompt(config, fetchInstructions),
        timezone: syncTz,
        name: "Idler discovery sync",
        submitResponseMode: "skipped",
        attachedTopics: [TOPIC],
      });
    }

    const lightSyncCron = buildLightSyncCron(schedule, "45", config.syncEveryHours);
    if (lightSyncCron) {
      specs.push({
        specKey: "sync-light",
        cronExpression: lightSyncCron,
        prompt: buildSyncLightPrompt(config),
        timezone: syncTz,
        name: "Idler light sync",
        submitResponseMode: "skipped",
        attachedTopics: [TOPIC],
      });
    }

    specs.push({
      specKey: "work",
      cronExpression: buildWindowCron(config.workHours, "*/15"),
      channel,
      prompt: buildWorkPrompt(config, fetchInstructions),
      timezone: tz,
      name: "Idler work",
      submitResponseMode: "optional",
      silent: config.reporting.tickUpdates === "none",
      attachedTopics: [TOPIC],
    });

    if (config.reporting.summary) {
      specs.push({
        specKey: "summary",
        cronExpression: buildSummaryCron(config.workHours, config.reporting.summaryHour ?? 9),
        channel,
        prompt: buildSummaryPrompt(),
        timezone: tz,
        name: "Idler summary",
        // `response-rendering` because the summary posts a rich digest; sync/work
        // fires stay lean (their deliverables are tool calls, not rich messages).
        attachedTopics: [TOPIC, "response-rendering"],
      });
    }

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
