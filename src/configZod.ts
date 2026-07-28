import { z } from "zod";
import { SUPPORTED_LANGUAGES, isSupportedLanguage } from "./i18n/languages.js";
import { logger } from "./logger.js";
import type { Config, SlackAuthConfig, JsonObject, JsonValue, CronConfig } from "./config.js";
import {
  VALID_DM_TYPES,
  isPlainObject,
  thinkingZod,
  emojiField,
  repositoryZod,
  reusableFoldersZod,
  reactionsChangesWorkflowZod,
  triggerChangesWorkflowZod,
  allowPublicSearchZod,
  mcpServersZod,
  skillPluginsZod,
  userSkillsZod,
  assistantZod,
  adminZod,
  submitResponseZod,
  testerZod,
  cronCatchUpZod,
  backupZod,
} from "./configSchemas.js";

const DEFAULT_TASK_CARD_MAX_DETAILS = 5;
const DEFAULT_SCHEDULED_MESSAGES_MAX_RUN_HISTORY = 50;

function throwFirstIssues(error: z.ZodError): never {
  throw new Error(error.issues.map((i) => i.message).join("; "));
}

function parseOrThrow<T>(schema: z.ZodType<T>, raw: JsonValue | undefined): T {
  const result = schema.safeParse(raw);
  if (!result.success) throwFirstIssues(result.error);
  return result.data;
}

function section(raw: JsonObject, key: string): JsonObject | undefined {
  const val = raw[key];
  return isPlainObject(val) ? val : undefined;
}

const stringOr = (v: JsonValue | undefined, fallback: string): string =>
  typeof v === "string" ? v : fallback;
const boolOr = (v: JsonValue | undefined, fallback: boolean): boolean =>
  typeof v === "boolean" ? v : fallback;
const numOr = (v: JsonValue | undefined, fallback: number): number =>
  typeof v === "number" ? v : fallback;
const optBool = (v: JsonValue | undefined): boolean | undefined =>
  typeof v === "boolean" ? v : undefined;
const optNum = (v: JsonValue | undefined): number | undefined =>
  typeof v === "number" ? v : undefined;
const optStr = (v: JsonValue | undefined): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

function parseGracefulInteger(
  val: JsonValue | undefined,
  keyName: string,
  fallbackLabel: number,
): number | undefined {
  if (val === undefined) return undefined;
  if (typeof val !== "number" || !Number.isInteger(val) || val < 1) {
    logger.warn(
      `Config '${keyName}' must be a positive integer (got ${JSON.stringify(val)}); falling back to default ${fallbackLabel}`,
    );
    return undefined;
  }
  return val;
}

export function validateConfig(config: unknown, slackAuth: SlackAuthConfig): Config {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Config must be an object");
  }
  const c = config as JsonObject;

  if (!Array.isArray(c.repositories)) {
    throw new Error("Config 'repositories' must be an array");
  }
  const repositories = c.repositories.map((r) => parseOrThrow(repositoryZod, r));

  if (c.language !== undefined && !isSupportedLanguage(c.language)) {
    throw new Error(
      `Config 'language' must be one of: ${SUPPORTED_LANGUAGES.join(", ")} (got ${JSON.stringify(c.language)})`,
    );
  }

  const dmRaw = section(c, "directMessages");
  if (dmRaw && dmRaw.dmType !== undefined) {
    const dt = dmRaw.dmType;
    if (typeof dt !== "string" || !(VALID_DM_TYPES as readonly string[]).includes(dt)) {
      throw new Error(
        `Config 'directMessages.dmType' must be one of: ${VALID_DM_TYPES.join(", ")} (got ${JSON.stringify(dt)})`,
      );
    }
  }

  const slackAppRaw = section(c, "slackApp");
  if (slackAppRaw) {
    const name = slackAppRaw.name;
    if (name !== undefined && (typeof name !== "string" || name.length === 0)) {
      throw new Error("Config 'slackApp.name' must be a non-empty string");
    }
    const bg = slackAppRaw.backgroundColor;
    if (bg !== undefined && (typeof bg !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(bg))) {
      throw new Error("Config 'slackApp.backgroundColor' must be a hex color (e.g., #4A154B)");
    }
  }

  const slackRaw = section(c, "slack");
  const reactionsRaw = section(c, "reactions");
  const mentionsRaw = section(c, "mentions");
  const autoRespondRaw = section(c, "autoRespond");
  const taskCardsRaw = section(c, "taskCards");
  const gitRaw = section(c, "git");
  const sessionsRaw = section(c, "sessions");
  const claudeCodeRaw = section(c, "claudeCode");
  const cwRaw = section(c, "changesWorkflow");
  const cronRaw = section(c, "cron");

  // Cron: legacy fallback + coercion + deprecation (graceful — never rejects)
  const legacyAllow = optBool(c.allowScheduledMessages);
  const legacyMaxRun = parseGracefulInteger(
    c.scheduledMessagesMaxRunHistory,
    "scheduledMessagesMaxRunHistory",
    DEFAULT_SCHEDULED_MESSAGES_MAX_RUN_HISTORY,
  );
  if (legacyAllow !== undefined || c.scheduledMessagesMaxRunHistory !== undefined) {
    logger.warn(
      "Config: top-level 'allowScheduledMessages' / 'scheduledMessagesMaxRunHistory' are deprecated; use 'cron.userSchedules' / 'cron.maxRunHistory' instead. The boot migration will rewrite these automatically.",
    );
  }
  const cronEnabled = cronRaw ? optBool(cronRaw.enabled) : undefined;
  let cronUserSchedules = cronRaw ? optBool(cronRaw.userSchedules) : undefined;
  if (cronUserSchedules === undefined && legacyAllow !== undefined) cronUserSchedules = legacyAllow;
  let cronMaxRunHistory = cronRaw
    ? parseGracefulInteger(
        cronRaw.maxRunHistory,
        "cron.maxRunHistory",
        DEFAULT_SCHEDULED_MESSAGES_MAX_RUN_HISTORY,
      )
    : undefined;
  if (cronMaxRunHistory === undefined && legacyMaxRun !== undefined)
    cronMaxRunHistory = legacyMaxRun;
  if (cronEnabled === false && cronUserSchedules === true) {
    logger.warn(
      "Config: 'cron.enabled' is false but 'cron.userSchedules' is true — forcing userSchedules to false (the scheduler tick loop is disabled, so user-facing scheduling tools cannot work).",
    );
    cronUserSchedules = false;
  }
  // catchUp is fail-fast (unlike the graceful legacy fields above): a typo'd delay
  // silently falling back to 3 minutes would be confusing to debug.
  const cronCatchUp = parseOrThrow(cronCatchUpZod, cronRaw?.catchUp);
  const cronConfig: CronConfig = {
    ...(cronEnabled !== undefined ? { enabled: cronEnabled } : {}),
    ...(cronUserSchedules !== undefined ? { userSchedules: cronUserSchedules } : {}),
    ...(cronMaxRunHistory !== undefined ? { maxRunHistory: cronMaxRunHistory } : {}),
    ...(cronCatchUp !== undefined ? { catchUp: cronCatchUp } : {}),
  };

  // taskCards (graceful — invalid value logs + degrades to {})
  let taskCards: Config["taskCards"];
  if (taskCardsRaw) {
    const val = taskCardsRaw.maxDetailsPerGroup;
    if (val === undefined) {
      taskCards = {};
    } else if (
      typeof val !== "number" ||
      !Number.isFinite(val) ||
      val < 0 ||
      !Number.isInteger(val)
    ) {
      logger.warn(
        `Config 'taskCards.maxDetailsPerGroup' must be a non-negative integer (got ${JSON.stringify(val)}); falling back to default ${DEFAULT_TASK_CARD_MAX_DETAILS}`,
      );
      taskCards = {};
    } else {
      taskCards = { maxDetailsPerGroup: val };
    }
  }

  const reusableFoldersRaw = cwRaw && section(cwRaw, "reusableFolders");
  const reusableFolders = reusableFoldersRaw
    ? parseOrThrow(reusableFoldersZod, reusableFoldersRaw)
    : undefined;

  const reactionsCwRaw = reactionsRaw && section(reactionsRaw, "changesWorkflow");
  const parsedReactionsCW = reactionsCwRaw
    ? parseOrThrow(reactionsChangesWorkflowZod, reactionsCwRaw)
    : undefined;

  const dmCw = dmRaw && section(dmRaw, "changesWorkflow");
  const mentionsCw = mentionsRaw && section(mentionsRaw, "changesWorkflow");
  const dmType =
    dmRaw && typeof dmRaw.dmType === "string"
      ? (dmRaw.dmType as Config["directMessages"]["dmType"])
      : "assistant";

  const additionalAllowedTools =
    cwRaw && Array.isArray(cwRaw.additionalAllowedTools)
      ? cwRaw.additionalAllowedTools.filter((v): v is string => typeof v === "string")
      : undefined;

  const merged: Config = {
    slack: {
      botToken: slackAuth.botToken,
      appToken: slackAuth.appToken,
      signingSecret: slackAuth.signingSecret,
      fetchAndStoreUsername: slackRaw ? boolOr(slackRaw.fetchAndStoreUsername, false) : false,
      sendErrorsAsDM: slackRaw ? boolOr(slackRaw.sendErrorsAsDM, false) : false,
    },
    slackApp: {
      name: slackAppRaw ? stringOr(slackAppRaw.name, "Clack") : "Clack",
      description: slackAppRaw
        ? stringOr(slackAppRaw.description, "Ask questions about your codebase using reactions")
        : "Ask questions about your codebase using reactions",
      backgroundColor: slackAppRaw ? stringOr(slackAppRaw.backgroundColor, "#4A154B") : "#4A154B",
    },
    reactions: {
      trigger: reactionsRaw
        ? stringOr(reactionsRaw.trigger, "robot_face") || "robot_face"
        : "robot_face",
      stop: parseOrThrow(emojiField("reactions.stop"), reactionsRaw?.stop),
      queuedFollowup: parseOrThrow(
        emojiField("reactions.queuedFollowup"),
        reactionsRaw?.queuedFollowup,
      ),
      thinking: parseOrThrow(thinkingZod, reactionsRaw && section(reactionsRaw, "thinking")) ?? {
        type: "message",
      },
      changesWorkflow: parsedReactionsCW,
    },
    directMessages: {
      enabled: dmRaw ? boolOr(dmRaw.enabled, false) : false,
      dmType,
      thinking: parseOrThrow(thinkingZod, dmRaw && section(dmRaw, "thinking")) ?? {
        type: "message",
      },
      changesWorkflow: dmCw ? parseOrThrow(triggerChangesWorkflowZod, dmCw) : undefined,
    },
    mentions: {
      enabled: mentionsRaw ? boolOr(mentionsRaw.enabled, false) : false,
      thinking: parseOrThrow(thinkingZod, mentionsRaw && section(mentionsRaw, "thinking")) ?? {
        type: "message",
      },
      changesWorkflow: mentionsCw ? parseOrThrow(triggerChangesWorkflowZod, mentionsCw) : undefined,
    },
    autoRespond: autoRespondRaw ? { enabled: boolOr(autoRespondRaw.enabled, false) } : undefined,
    assistant: parseOrThrow(assistantZod, c.assistant),
    taskCards,
    repositories,
    git: {
      pullIntervalMinutes: gitRaw ? numOr(gitRaw.pullIntervalMinutes, 60) : 60,
      shallowClone: gitRaw ? boolOr(gitRaw.shallowClone, true) : true,
      cloneDepth: gitRaw ? numOr(gitRaw.cloneDepth, 1) : 1,
    },
    sessions: {
      cleanupIntervalMinutes: sessionsRaw ? numOr(sessionsRaw.cleanupIntervalMinutes, 60) : 60,
    },
    claudeCode: {
      model: claudeCodeRaw ? stringOr(claudeCodeRaw.model, "sonnet") : "sonnet",
      workerModel: claudeCodeRaw ? optStr(claudeCodeRaw.workerModel) : undefined,
      preAnalysisModel: claudeCodeRaw ? optStr(claudeCodeRaw.preAnalysisModel) : undefined,
      watchMcpConfig: claudeCodeRaw ? boolOr(claudeCodeRaw.watchMcpConfig, false) : false,
    },
    changesWorkflow: cwRaw
      ? {
          enabled: boolOr(cwRaw.enabled, false),
          timeoutMinutes: optNum(cwRaw.timeoutMinutes),
          additionalAllowedTools,
          sessionExpiryHours: optNum(cwRaw.sessionExpiryHours),
          monitoringIntervalMinutes: optNum(cwRaw.monitoringIntervalMinutes),
          reusableFolders,
          maxActiveChangesPerUser: optNum(cwRaw.maxActiveChangesPerUser),
          requirePRReviewers: boolOr(cwRaw.requirePRReviewers, false),
        }
      : undefined,
    cron: cronConfig,
    backup: parseOrThrow(backupZod, c.backup),
    threadAutoRespond: optBool(c.threadAutoRespond),
    threadAutoRespondMaxAgeMinutes: optNum(c.threadAutoRespondMaxAgeMinutes),
    plugins: Array.isArray(c.plugins)
      ? c.plugins.filter((v): v is string => typeof v === "string")
      : undefined,
    mcpServers: parseOrThrow(mcpServersZod, c.mcpServers),
    skillPlugins: parseOrThrow(skillPluginsZod, c.skillPlugins),
    userSkills: parseOrThrow(userSkillsZod, c.userSkills),
    submitResponse: parseOrThrow(submitResponseZod, c.submitResponse),
    admin: parseOrThrow(adminZod, c.admin),
    tester: parseOrThrow(testerZod, c.tester),
    allowPublicSearch: parseOrThrow(allowPublicSearchZod, c.allowPublicSearch),
    language: isSupportedLanguage(c.language) ? c.language : undefined,
  };

  return merged;
}
