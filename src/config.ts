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
  timeoutMinutes: number;
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
    timeoutMinutes: 1440, // 24 hours (legacy, age-based eviction uses MAX_AGE_DAYS)
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
    botToken: auth.botToken as string,
    appToken: auth.appToken as string,
    signingSecret: auth.signingSecret as string,
  };
}

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
    // supportsChanges is handled by migration v1 — just ignore it during validation
    const validRoles: UserRole[] = ["member", "dev", "admin", "owner"];
    if (r.access !== undefined) {
      if (typeof r.access !== "object" || r.access === null) {
        throw new Error(`Repository '${r.name}' access must be an object`);
      }
      const acc = r.access as Record<string, unknown>;
      if (acc.read !== undefined && !validRoles.includes(acc.read as UserRole)) {
        throw new Error(`Repository '${r.name}' access.read must be one of: ${validRoles.join(", ")}`);
      }
      if (acc.write !== undefined && !validRoles.includes(acc.write as UserRole)) {
        throw new Error(`Repository '${r.name}' access.write must be one of: ${validRoles.join(", ")}`);
      }
    }
  }

  // Validate slackApp if provided
  const slackApp = c.slackApp as Record<string, unknown> | undefined;
  if (slackApp) {
    if (slackApp.name !== undefined && (typeof slackApp.name !== "string" || slackApp.name.length === 0)) {
      throw new Error("Config 'slackApp.name' must be a non-empty string");
    }
    if (slackApp.backgroundColor !== undefined) {
      const bgColor = slackApp.backgroundColor as string;
      if (typeof bgColor !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(bgColor)) {
        throw new Error("Config 'slackApp.backgroundColor' must be a hex color (e.g., #4A154B)");
      }
    }
  }

  // Merge with defaults
  const merged: Config = {
    slack: {
      botToken: slackAuth.botToken,
      appToken: slackAuth.appToken,
      signingSecret: slackAuth.signingSecret,
      fetchAndStoreUsername: ((c.slack as Record<string, unknown>)?.fetchAndStoreUsername as boolean) ?? false,
      sendErrorsAsDM: ((c.slack as Record<string, unknown>)?.sendErrorsAsDM as boolean) ?? false,
    },
    slackApp: {
      name: (slackApp?.name as string) ?? DEFAULTS.slackApp!.name,
      description: (slackApp?.description as string) ?? DEFAULTS.slackApp!.description,
      backgroundColor: (slackApp?.backgroundColor as string) ?? DEFAULTS.slackApp!.backgroundColor,
    },
    reactions: {
      trigger: (c.reactions as Record<string, unknown>)?.trigger as string || DEFAULTS.reactions!.trigger,
      thinking: (c.reactions as Record<string, unknown>)?.thinking
        ? {
            type: ((c.reactions as Record<string, unknown>).thinking as Record<string, unknown>).type as "message" | "emoji",
            emoji: ((c.reactions as Record<string, unknown>).thinking as Record<string, unknown>).emoji as string | undefined,
          }
        : DEFAULTS.reactions!.thinking,
      changesWorkflow: (c.reactions as Record<string, unknown>)?.changesWorkflow
        ? {
            enabled: ((c.reactions as Record<string, unknown>).changesWorkflow as Record<string, unknown>).enabled as boolean,
            trigger: ((c.reactions as Record<string, unknown>).changesWorkflow as Record<string, unknown>).trigger as string | undefined,
          }
        : undefined,
    },
    directMessages: {
      enabled:
        ((c.directMessages as Record<string, unknown>)?.enabled as boolean) ??
        DEFAULTS.directMessages!.enabled,
      thinking: (c.directMessages as Record<string, unknown>)?.thinking
        ? {
            type: ((c.directMessages as Record<string, unknown>).thinking as Record<string, unknown>).type as "message" | "emoji",
            emoji: ((c.directMessages as Record<string, unknown>).thinking as Record<string, unknown>).emoji as string | undefined,
          }
        : DEFAULTS.directMessages!.thinking,
      changesWorkflow: (c.directMessages as Record<string, unknown>)?.changesWorkflow
        ? {
            enabled: ((c.directMessages as Record<string, unknown>).changesWorkflow as Record<string, unknown>).enabled as boolean,
          }
        : undefined,
    },
    mentions: {
      enabled:
        ((c.mentions as Record<string, unknown>)?.enabled as boolean) ??
        DEFAULTS.mentions!.enabled,
      thinking: (c.mentions as Record<string, unknown>)?.thinking
        ? {
            type: ((c.mentions as Record<string, unknown>).thinking as Record<string, unknown>).type as "message" | "emoji",
            emoji: ((c.mentions as Record<string, unknown>).thinking as Record<string, unknown>).emoji as string | undefined,
          }
        : DEFAULTS.mentions!.thinking,
      changesWorkflow: (c.mentions as Record<string, unknown>)?.changesWorkflow
        ? {
            enabled: ((c.mentions as Record<string, unknown>).changesWorkflow as Record<string, unknown>).enabled as boolean,
          }
        : undefined,
    },
    repositories: c.repositories.map((r: Record<string, unknown>) => {
      const access = r.access as Record<string, unknown> | undefined;
      return {
        name: r.name as string,
        url: r.url as string,
        description: r.description as string,
        branch: (r.branch as string) || "main",
        access: access
          ? {
              read: access.read as UserRole | undefined,
              write: access.write as UserRole | undefined,
            }
          : undefined,
        worktreeBasePath: r.worktreeBasePath as string | undefined,
        mergeStrategy: r.mergeStrategy as "squash" | "merge" | "rebase" | undefined,
      };
    }),
    git: {
      pullIntervalMinutes:
        ((c.git as Record<string, unknown>)?.pullIntervalMinutes as number) ??
        DEFAULTS.git!.pullIntervalMinutes,
      shallowClone:
        ((c.git as Record<string, unknown>)?.shallowClone as boolean) ??
        DEFAULTS.git!.shallowClone,
      cloneDepth:
        ((c.git as Record<string, unknown>)?.cloneDepth as number) ??
        DEFAULTS.git!.cloneDepth,
    },
    sessions: {
      timeoutMinutes:
        ((c.sessions as Record<string, unknown>)?.timeoutMinutes as number) ??
        DEFAULTS.sessions!.timeoutMinutes,
      cleanupIntervalMinutes:
        ((c.sessions as Record<string, unknown>)?.cleanupIntervalMinutes as number) ??
        DEFAULTS.sessions!.cleanupIntervalMinutes,
    },
    claudeCode: {
      model:
        ((c.claudeCode as Record<string, unknown>)?.model as string) ??
        DEFAULTS.claudeCode!.model,
    },
    changesWorkflow: c.changesWorkflow
      ? {
          enabled: (c.changesWorkflow as Record<string, unknown>).enabled as boolean,
          timeoutMinutes: (c.changesWorkflow as Record<string, unknown>).timeoutMinutes as number | undefined,

          additionalAllowedTools: (c.changesWorkflow as Record<string, unknown>).additionalAllowedTools as string[] | undefined,
          sessionExpiryHours: (c.changesWorkflow as Record<string, unknown>).sessionExpiryHours as number | undefined,
          monitoringIntervalMinutes: (c.changesWorkflow as Record<string, unknown>).monitoringIntervalMinutes as number | undefined,
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
