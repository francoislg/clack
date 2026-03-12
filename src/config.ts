import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { UserRole } from "./roles.js";

export interface SlackAuthConfig {
  botToken: string;
  appToken: string;
  signingSecret: string;
}

export interface SlackConfig {
  botToken: string;
  appToken: string;
  signingSecret: string;
  fetchAndStoreUsername: boolean;
  sendErrorsAsDM: boolean;
}

export interface RepoAccess {
  read?: UserRole;
  write?: UserRole;
}

export interface RepositoryConfig {
  name: string;
  url: string;
  description: string;
  branch?: string;
  access?: RepoAccess;
  worktreeBasePath?: string;
  mergeStrategy?: "squash" | "merge" | "rebase";
}

export interface GitConfig {
  pullIntervalMinutes: number;
  shallowClone: boolean;
  cloneDepth: number;
}

export interface SessionsConfig {
  cleanupIntervalMinutes: number;
}

export interface ClaudeCodeConfig {
  model?: string;
}

export interface SlackAppConfig {
  name?: string;
  description?: string;
  backgroundColor?: string;
}

export interface ThinkingFeedbackConfig {
  type: "message" | "emoji";
  emoji?: string;
}

// Changes Workflow configuration
export interface ChangesWorkflowConfig {
  enabled: boolean;
  timeoutMinutes?: number;

  additionalAllowedTools?: string[];
  sessionExpiryHours?: number;
  monitoringIntervalMinutes?: number;
}

// Per-trigger changes workflow config
export interface TriggerChangesWorkflowConfig {
  enabled: boolean;
}

// Reactions-specific changes workflow config (can have different trigger emoji)
export interface ReactionsChangesWorkflowConfig extends TriggerChangesWorkflowConfig {
  trigger?: string;
}

export interface ReactionsConfig {
  trigger: string;
  thinking?: ThinkingFeedbackConfig;
  changesWorkflow?: ReactionsChangesWorkflowConfig;
}

export interface DirectMessagesConfig {
  enabled: boolean;
  thinking?: ThinkingFeedbackConfig;
  changesWorkflow?: TriggerChangesWorkflowConfig;
}

export interface MentionsConfig {
  enabled: boolean;
  thinking?: ThinkingFeedbackConfig;
  changesWorkflow?: TriggerChangesWorkflowConfig;
}

export interface Config {
  slack: SlackConfig;
  slackApp?: SlackAppConfig;
  reactions: ReactionsConfig;
  directMessages: DirectMessagesConfig;
  mentions: MentionsConfig;
  repositories: RepositoryConfig[];
  git: GitConfig;
  sessions: SessionsConfig;
  claudeCode: ClaudeCodeConfig;
  changesWorkflow?: ChangesWorkflowConfig;
}

const DEFAULTS: Partial<Config> = {
  slackApp: {
    name: "Clack",
    description: "Ask questions about your codebase using reactions",
    backgroundColor: "#4A154B",
  },
  reactions: {
    trigger: "robot_face",
    thinking: {
      type: "message",
    },
  },
  directMessages: {
    enabled: false,
    thinking: {
      type: "message",
    },
  },
  mentions: {
    enabled: false,
    thinking: {
      type: "message",
    },
  },
  git: {
    pullIntervalMinutes: 60,
    shallowClone: true,
    cloneDepth: 1,
  },
  sessions: {
    cleanupIntervalMinutes: 60,
  },
  claudeCode: {
    model: "sonnet",
  },
};

function loadSlackAuth(): SlackAuthConfig {
  const authPath = resolve(process.cwd(), "data", "auth", "slack.json");

  if (!existsSync(authPath)) {
    throw new Error(
      `Slack auth file not found at ${authPath}.\n` +
      `Run 'npm run docker-setup' or create data/auth/slack.json manually.\n` +
      `See data/auth/slack.example.json for the expected format.`
    );
  }

  const content = readFileSync(authPath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Slack auth file is not valid JSON: ${authPath}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Slack auth file must be an object");
  }

  const auth = parsed as Record<string, unknown>;

  if (typeof auth.botToken !== "string" || !auth.botToken.startsWith("xoxb-")) {
    throw new Error("Slack auth 'botToken' must be a valid bot token (starts with xoxb-)");
  }
  if (typeof auth.appToken !== "string" || !auth.appToken.startsWith("xapp-")) {
    throw new Error("Slack auth 'appToken' must be a valid app token (starts with xapp-)");
  }
  if (typeof auth.signingSecret !== "string" || auth.signingSecret.length === 0) {
    throw new Error("Slack auth 'signingSecret' is required");
  }

  return {
    botToken: auth.botToken,
    appToken: auth.appToken,
    signingSecret: auth.signingSecret,
  } as SlackAuthConfig;
}

// ============================================================================
// Config Parsing Helpers
// ============================================================================

/** Safely extract a nested object section from raw config */
function section(obj: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const val = obj[key];
  if (val && typeof val === "object" && !Array.isArray(val)) {
    return val as Record<string, unknown>;
  }
  return undefined;
}

/** Read a typed field from a raw config object */
function str(obj: Record<string, unknown>, key: string): string | undefined {
  const val = obj[key];
  return typeof val === "string" ? val : undefined;
}

function bool(obj: Record<string, unknown>, key: string): boolean | undefined {
  const val = obj[key];
  return typeof val === "boolean" ? val : undefined;
}

function num(obj: Record<string, unknown>, key: string): number | undefined {
  const val = obj[key];
  return typeof val === "number" ? val : undefined;
}

function strArray(obj: Record<string, unknown>, key: string): string[] | undefined {
  const val = obj[key];
  return Array.isArray(val) ? val.filter((v): v is string => typeof v === "string") : undefined;
}

function parseThinking(raw: Record<string, unknown> | undefined, fallback?: ThinkingFeedbackConfig): ThinkingFeedbackConfig | undefined {
  if (!raw) return fallback;
  const type = str(raw, "type");
  if (type !== "message" && type !== "emoji") return fallback;
  return { type, emoji: str(raw, "emoji") };
}

function parseTriggerChangesWorkflow(raw: Record<string, unknown> | undefined): TriggerChangesWorkflowConfig | undefined {
  if (!raw) return undefined;
  return { enabled: bool(raw, "enabled") ?? false };
}

const VALID_MERGE_STRATEGIES = ["squash", "merge", "rebase"] as const;
const VALID_ROLES: readonly UserRole[] = ["member", "dev", "admin", "owner"];

function isValidRole(value: string): value is UserRole {
  return (VALID_ROLES as readonly string[]).includes(value);
}

function parseMergeStrategy(raw: Record<string, unknown>): RepositoryConfig["mergeStrategy"] {
  const value = str(raw, "mergeStrategy");
  if (value === undefined) return undefined;
  if (!(VALID_MERGE_STRATEGIES as readonly string[]).includes(value)) {
    throw new Error(
      `Repository 'mergeStrategy' must be one of: ${VALID_MERGE_STRATEGIES.join(", ")} (got '${value}')`
    );
  }
  return value as RepositoryConfig["mergeStrategy"];
}

function parseRepoAccess(access: Record<string, unknown>): RepoAccess {
  const readVal = str(access, "read");
  const writeVal = str(access, "write");
  return {
    read: readVal !== undefined && isValidRole(readVal) ? readVal : undefined,
    write: writeVal !== undefined && isValidRole(writeVal) ? writeVal : undefined,
  };
}

function parseRepo(raw: Record<string, unknown>): RepositoryConfig {
  const name = str(raw, "name");
  const url = str(raw, "url");
  const description = str(raw, "description");

  if (!name) throw new Error("Repository 'name' is required");
  if (!url) throw new Error("Repository 'url' is required");
  if (description === undefined) throw new Error("Repository 'description' is required");

  const access = section(raw, "access");
  return {
    name,
    url,
    description,
    branch: str(raw, "branch") || "main",
    access: access ? parseRepoAccess(access) : undefined,
    worktreeBasePath: str(raw, "worktreeBasePath"),
    mergeStrategy: parseMergeStrategy(raw),
  };
}

// ============================================================================
// Config Validation
// ============================================================================

function validateConfig(config: unknown, slackAuth: SlackAuthConfig): Config {
  if (!config || typeof config !== "object") {
    throw new Error("Config must be an object");
  }

  const c = config as Record<string, unknown>;

  // Validate repositories
  if (!Array.isArray(c.repositories) || c.repositories.length === 0) {
    throw new Error("Config 'repositories' must be a non-empty array");
  }
  for (const repo of c.repositories) {
    if (typeof repo !== "object" || repo === null) {
      throw new Error("Each repository must be an object");
    }
    const r = repo as Record<string, unknown>;
    if (typeof r.name !== "string" || r.name.length === 0) {
      throw new Error("Repository 'name' is required");
    }
    if (typeof r.url !== "string" || r.url.length === 0) {
      throw new Error("Repository 'url' is required");
    }
    if (typeof r.description !== "string") {
      throw new Error("Repository 'description' is required");
    }
    const acc = section(r, "access");
    if (acc) {
      const readVal = acc.read;
      if (readVal !== undefined && (typeof readVal !== "string" || !isValidRole(readVal))) {
        throw new Error(`Repository '${r.name}' access.read must be one of: ${VALID_ROLES.join(", ")}`);
      }
      const writeVal = acc.write;
      if (writeVal !== undefined && (typeof writeVal !== "string" || !isValidRole(writeVal))) {
        throw new Error(`Repository '${r.name}' access.write must be one of: ${VALID_ROLES.join(", ")}`);
      }
    }
  }

  // Validate slackApp if provided
  const slackAppRaw = section(c, "slackApp");
  if (slackAppRaw) {
    if (slackAppRaw.name !== undefined && (typeof slackAppRaw.name !== "string" || (slackAppRaw.name as string).length === 0)) {
      throw new Error("Config 'slackApp.name' must be a non-empty string");
    }
    if (slackAppRaw.backgroundColor !== undefined) {
      const bgColor = slackAppRaw.backgroundColor;
      if (typeof bgColor !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(bgColor)) {
        throw new Error("Config 'slackApp.backgroundColor' must be a hex color (e.g., #4A154B)");
      }
    }
  }

  // Extract sections
  const slackRaw = section(c, "slack");
  const reactionsRaw = section(c, "reactions");
  const dmRaw = section(c, "directMessages");
  const mentionsRaw = section(c, "mentions");
  const gitRaw = section(c, "git");
  const sessionsRaw = section(c, "sessions");
  const claudeCodeRaw = section(c, "claudeCode");
  const cwRaw = section(c, "changesWorkflow");

  // Parse reactions changes workflow (has extra "trigger" field)
  const reactionsChangesWorkflow = reactionsRaw ? section(reactionsRaw, "changesWorkflow") : undefined;
  const parsedReactionsCW: ReactionsChangesWorkflowConfig | undefined = reactionsChangesWorkflow
    ? { enabled: bool(reactionsChangesWorkflow, "enabled") ?? false, trigger: str(reactionsChangesWorkflow, "trigger") }
    : undefined;

  // Merge with defaults
  const merged: Config = {
    slack: {
      botToken: slackAuth.botToken,
      appToken: slackAuth.appToken,
      signingSecret: slackAuth.signingSecret,
      fetchAndStoreUsername: (slackRaw && bool(slackRaw, "fetchAndStoreUsername")) ?? false,
      sendErrorsAsDM: (slackRaw && bool(slackRaw, "sendErrorsAsDM")) ?? false,
    },
    slackApp: {
      name: (slackAppRaw && str(slackAppRaw, "name")) ?? DEFAULTS.slackApp!.name,
      description: (slackAppRaw && str(slackAppRaw, "description")) ?? DEFAULTS.slackApp!.description,
      backgroundColor: (slackAppRaw && str(slackAppRaw, "backgroundColor")) ?? DEFAULTS.slackApp!.backgroundColor,
    },
    reactions: {
      trigger: (reactionsRaw && str(reactionsRaw, "trigger")) || DEFAULTS.reactions!.trigger,
      thinking: parseThinking(reactionsRaw && section(reactionsRaw, "thinking"), DEFAULTS.reactions!.thinking),
      changesWorkflow: parsedReactionsCW,
    },
    directMessages: {
      enabled: (dmRaw && bool(dmRaw, "enabled")) ?? DEFAULTS.directMessages!.enabled,
      thinking: parseThinking(dmRaw && section(dmRaw, "thinking"), DEFAULTS.directMessages!.thinking),
      changesWorkflow: parseTriggerChangesWorkflow(dmRaw && section(dmRaw, "changesWorkflow")),
    },
    mentions: {
      enabled: (mentionsRaw && bool(mentionsRaw, "enabled")) ?? DEFAULTS.mentions!.enabled,
      thinking: parseThinking(mentionsRaw && section(mentionsRaw, "thinking"), DEFAULTS.mentions!.thinking),
      changesWorkflow: parseTriggerChangesWorkflow(mentionsRaw && section(mentionsRaw, "changesWorkflow")),
    },
    repositories: c.repositories.map((r: unknown) => parseRepo(r as Record<string, unknown>)),
    git: {
      pullIntervalMinutes: (gitRaw && num(gitRaw, "pullIntervalMinutes")) ?? DEFAULTS.git!.pullIntervalMinutes,
      shallowClone: (gitRaw && bool(gitRaw, "shallowClone")) ?? DEFAULTS.git!.shallowClone,
      cloneDepth: (gitRaw && num(gitRaw, "cloneDepth")) ?? DEFAULTS.git!.cloneDepth,
    },
    sessions: {
      cleanupIntervalMinutes: (sessionsRaw && num(sessionsRaw, "cleanupIntervalMinutes")) ?? DEFAULTS.sessions!.cleanupIntervalMinutes,
    },
    claudeCode: {
      model: (claudeCodeRaw && str(claudeCodeRaw, "model")) ?? DEFAULTS.claudeCode!.model,
    },
    changesWorkflow: cwRaw
      ? {
          enabled: bool(cwRaw, "enabled") ?? false,
          timeoutMinutes: num(cwRaw, "timeoutMinutes"),
          additionalAllowedTools: strArray(cwRaw, "additionalAllowedTools"),
          sessionExpiryHours: num(cwRaw, "sessionExpiryHours"),
          monitoringIntervalMinutes: num(cwRaw, "monitoringIntervalMinutes"),
        }
      : undefined,
  };

  return merged;
}

let cachedConfig: Config | null = null;

export function loadConfig(configPath?: string, forceReload?: boolean): Config {
  if (cachedConfig && !forceReload) {
    return cachedConfig;
  }

  const path = configPath || resolve(process.cwd(), "data", "config.json");

  if (!existsSync(path)) {
    throw new Error(
      `Config file not found at ${path}. Copy data/config.example.json to data/config.json and fill in your values.`
    );
  }

  const content = readFileSync(path, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Config file is not valid JSON: ${path}`);
  }

  // Load Slack auth from separate file
  const slackAuth = loadSlackAuth();

  cachedConfig = validateConfig(parsed, slackAuth);
  return cachedConfig;
}

export function getConfig(): Config {
  if (!cachedConfig) {
    throw new Error("Config not loaded. Call loadConfig() first.");
  }
  return cachedConfig;
}

export function getDataDir(): string {
  return resolve(process.cwd(), "data");
}

export function getRepositoriesDir(): string {
  return resolve(getDataDir(), "repositories");
}

export function getSessionsDir(): string {
  return resolve(getDataDir(), "sessions");
}

export function getWorktreesDir(): string {
  return resolve(getDataDir(), "worktrees");
}

export function getConfigurationDir(): string {
  return resolve(getDataDir(), "configuration");
}

export function getDefaultConfigurationDir(): string {
  return resolve(getDataDir(), "default_configuration");
}

export function getWorktreeSessionsDir(): string {
  return resolve(getDataDir(), "worktree-sessions");
}

export function findRepoByName(
  name: string,
  config: Config
): RepositoryConfig | undefined {
  return config.repositories.find(
    (r) => r.name.toLowerCase() === name.toLowerCase()
  );
}
