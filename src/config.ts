import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface SlackConfig {
  botToken: string;
  appToken: string;
  signingSecret: string;
}

export interface RepositoryConfig {
  name: string;
  url: string;
  description: string;
  branch?: string;
}

export interface GitConfig {
  sshKeyPath?: string;
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

export interface ThinkingFeedbackConfig {
  type: "message" | "emoji";
  emoji?: string;
}

export interface Config {
  slack: SlackConfig;
  triggerReaction: string;
  thinkingFeedback?: ThinkingFeedbackConfig;
  repositories: RepositoryConfig[];
  git: GitConfig;
  sessions: SessionsConfig;
  claudeCode: ClaudeCodeConfig;
}

const DEFAULTS: Partial<Config> = {
  triggerReaction: "robot_face",
  thinkingFeedback: {
    type: "message",
  },
  git: {
    pullIntervalMinutes: 60,
    shallowClone: true,
    cloneDepth: 1,
  },
  sessions: {
    timeoutMinutes: 15,
    cleanupIntervalMinutes: 5,
  },
  claudeCode: {
    model: "sonnet",
  },
};

function validateConfig(config: unknown): Config {
  if (!config || typeof config !== "object") {
    throw new Error("Config must be an object");
  }

  const c = config as Record<string, unknown>;

  // Validate slack
  if (!c.slack || typeof c.slack !== "object") {
    throw new Error("Config missing 'slack' section");
  }
  const slack = c.slack as Record<string, unknown>;
  if (typeof slack.botToken !== "string" || !slack.botToken.startsWith("xoxb-")) {
    throw new Error("Config 'slack.botToken' must be a valid bot token (starts with xoxb-)");
  }
  if (typeof slack.appToken !== "string" || !slack.appToken.startsWith("xapp-")) {
    throw new Error("Config 'slack.appToken' must be a valid app token (starts with xapp-)");
  }
  if (typeof slack.signingSecret !== "string" || slack.signingSecret.length === 0) {
    throw new Error("Config 'slack.signingSecret' is required");
  }

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
  }

  // Merge with defaults
  const merged: Config = {
    slack: {
      botToken: slack.botToken as string,
      appToken: slack.appToken as string,
      signingSecret: slack.signingSecret as string,
    },
    triggerReaction: (c.triggerReaction as string) || DEFAULTS.triggerReaction!,
    thinkingFeedback: c.thinkingFeedback
      ? {
          type: (c.thinkingFeedback as Record<string, unknown>).type as "message" | "emoji",
          emoji: (c.thinkingFeedback as Record<string, unknown>).emoji as string | undefined,
        }
      : DEFAULTS.thinkingFeedback,
    repositories: c.repositories.map((r: Record<string, unknown>) => ({
      name: r.name as string,
      url: r.url as string,
      description: r.description as string,
      branch: (r.branch as string) || "main",
    })),
    git: {
      sshKeyPath: (c.git as Record<string, unknown>)?.sshKeyPath as string | undefined,
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
  };

  return merged;
}

let cachedConfig: Config | null = null;

export function loadConfig(configPath?: string): Config {
  if (cachedConfig) {
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

  cachedConfig = validateConfig(parsed);
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
