import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { UserRole } from "./roles.js";
import { logger } from "./logger.js";
import { SUPPORTED_LANGUAGES, isSupportedLanguage, type Lang } from "./i18n/languages.js";

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
  watchMcpConfig?: boolean;
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

/**
 * Reusable worker folder pool config. When `enabled`, change requests are routed through
 * a pool of long-lived `worker-N` folders instead of the default disposable per-branch model.
 */
export interface ReusableFoldersConfig {
  enabled: boolean;
  /** Workers to provision asynchronously at boot, per repo. */
  minimumProvisioned?: number;
  /** Hard cap on pool size per repo; new requests beyond this enqueue. */
  maxConcurrent?: number;
  /** FIFO queue depth bound per repo; beyond this, requests are rejected. */
  maxQueueDepth?: number;
  /** Detach session-bound idle workers after this many hours of no activity. */
  idleReleaseHours?: number;
  /** Quarantine workers with modified-tracked files instead of branch-switching. */
  dirtyTrackedQuarantine?: boolean;
}

// Changes Workflow configuration
export interface ChangesWorkflowConfig {
  enabled: boolean;
  timeoutMinutes?: number;

  additionalAllowedTools?: string[];
  sessionExpiryHours?: number;
  monitoringIntervalMinutes?: number;
  reusableFolders?: ReusableFoldersConfig;
  /**
   * Max simultaneously-executing changes per user. Counts only changes in
   * `executing`/`reviewing`/`merging` — idle states (`pr_created`, `completed`,
   * `failed`, `cancelled`) never block. Defaults to 1. Set to 0 to disable the
   * gate entirely (rely on the worker pool's queue for backpressure instead).
   */
  maxActiveChangesPerUser?: number;
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
  /** Stop reaction emoji name (without colons). Null/empty disables the stop feature. */
  stop?: string | null;
  /**
   * Emoji name (without colons) added to a user message when their follow-up is appended
   * onto an in-flight Claude run via `handle.sendUpdate`. Acts as a quiet ack so the user
   * sees their message landed. Defaults to `eyes`. Set to `null` or empty to disable.
   */
  queuedFollowup?: string | null;
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

export interface AutoRespondConfig {
  enabled: boolean;
}

// Trivia types, defaults, and parsers were relocated to the trivia plugin per
// the SDK-isolation rules (src/plugins/CLAUDE.md). See:
//   - src/plugins/trivia/core/configTypes.ts (types + defaults)
//   - src/plugins/trivia/core/configParsers/{axes,games}.ts (validators)
//   - src/plugins/trivia/core/configBridge.ts (file I/O + cache)
// Migration 022 moves any legacy data/config.json.trivia into the new file
// location at boot.

export interface TaskCardsConfig {
  /** Default cap on detail lines rendered per grouped tool task card. */
  maxDetailsPerGroup?: number;
}

/** Built-in fallback when neither per-group nor global config sets a cap. */
export const DEFAULT_TASK_CARD_MAX_DETAILS = 5;
export const DEFAULT_SCHEDULED_MESSAGES_MAX_RUN_HISTORY = 50;

/**
 * Clack-owned metadata about an MCP server. `data/mcp.json` stays in pure Claude SDK shape;
 * this registry (under `config.mcpServers`) adds:
 *  - `alwaysLoad`: whether to attach at session start vs. lazy-load via `attach_integration`
 *  - `description`: one-line reason Claude should use the integration (shown in the catalog block)
 *  - `toolMapping`: optional override pointing several servers at one shared tool-mapping file
 *    (`name`) and appending an environment label suffix (`label`) to the group banner / default
 *    fallback so e.g. `mongodb-dev` and `mongodb-prod` can both reuse `mongodb.json` while still
 *    rendering the group title as "Checking MongoDB (dev)" / "Checking MongoDB (prod)". Per-tool
 *    labels (e.g. "Querying users.accounts") are intentionally left suffix-free — the group
 *    banner already carries the environment, so repeating it on each sub-item is noise.
 */
export interface McpServerRegistryEntry {
  alwaysLoad: boolean;
  description: string;
  toolMapping?: McpToolMappingOverride;
}

export interface McpToolMappingOverride {
  name: string;
  label?: string;
}

export type McpServerRegistry = Record<string, McpServerRegistryEntry>;

/**
 * Clack-owned metadata about a Claude Code skill plugin directory under `data/skill-plugins/`.
 * Mirrors `McpServerRegistryEntry` in shape. `lazyLoad: true` excludes the plugin from the SDK
 * session-start `plugins` array — its skills are discovered via `list_skill_pack_skills` and
 * loaded via `load_skill` instead. `description` is required for lazy packs (rendered in the
 * AVAILABLE SKILL PACKS catalog); optional and unused for eager packs.
 */
export interface SkillPluginEntry {
  lazyLoad: boolean;
  description: string;
}

export type SkillPluginRegistry = Record<string, SkillPluginEntry>;

/**
 * Per-installation tuning for `submit_response`. Only `maxAdditionalMessages` lives here
 * today — it bounds how many sibling messages a single scheduled-mode batch (or a single
 * `post_to` action) may carry. The 20-cap on `thread_replies` is intentionally fixed and
 * does NOT live here; see the multi-message design doc for the rationale.
 */
export interface SubmitResponseConfig {
  /** Inclusive cap on `additional_messages.length`. Default 5, valid range [1, 10]. */
  maxAdditionalMessages: number;
}

export const DEFAULT_MAX_ADDITIONAL_MESSAGES = 5;
const MAX_ADDITIONAL_MESSAGES_MIN = 1;
const MAX_ADDITIONAL_MESSAGES_MAX = 10;

export interface Config {
  slack: SlackConfig;
  slackApp?: SlackAppConfig;
  reactions: ReactionsConfig;
  directMessages: DirectMessagesConfig;
  mentions: MentionsConfig;
  autoRespond?: AutoRespondConfig;
  taskCards?: TaskCardsConfig;
  repositories: RepositoryConfig[];
  git: GitConfig;
  sessions: SessionsConfig;
  claudeCode: ClaudeCodeConfig;
  changesWorkflow?: ChangesWorkflowConfig;
  allowScheduledMessages?: boolean;
  /**
   * Maximum number of execution records retained per scheduled job in `runs[]`.
   * Older entries are dropped from the front when a new run is recorded. Default 50.
   */
  scheduledMessagesMaxRunHistory?: number;
  /** Auto-respond to thread replies in existing sessions (default: true) */
  threadAutoRespond?: boolean;
  /** Disengage thread auto-respond if the triggering message is older than this many minutes (default: 60) */
  threadAutoRespondMaxAgeMinutes?: number;
  /** List of Clack plugin names to load at startup */
  plugins?: string[];
  /**
   * Clack-owned MCP server registry. Keyed by server name. Declares each server's
   * `alwaysLoad` flag (session-start attach vs. lazy) and a `description` shown in the
   * integrations catalog. Entries without a matching `data/mcp.json` server are valid
   * (instructions-only topics). Servers in `data/mcp.json` without a registry entry are
   * auto-loaded with a warning — see `resolveEffectiveRegistry` in `src/mcp.ts`.
   */
  mcpServers?: McpServerRegistry;
  /**
   * Clack-owned skill-plugin registry. Keyed by the plugin directory name under
   * `data/skill-plugins/`. Declares each plugin's `lazyLoad` flag and a `description`
   * for the AVAILABLE SKILL PACKS catalog. Plugins without an entry default to eager
   * loading (passed via `--plugin-dir` at session start, same as pre-lazy behavior).
   */
  skillPlugins?: SkillPluginRegistry;
  /**
   * Per-installation tuning for `submit_response`. Currently only carries the
   * `maxAdditionalMessages` cap. Absent → defaults applied at parse time.
   */
  submitResponse?: SubmitResponseConfig;
  /**
   * Workspace-global user-facing language. BCP-47 short code. When absent or `"en"`,
   * the bot behaves identically to its pre-localization state. When set to `"fr"`,
   * `t()`-rendered UI strings and Claude's user-facing output flip to French.
   */
  language?: Lang;
}

const DEFAULTS: Partial<Config> = {
  slackApp: {
    name: "Clack",
    description: "Ask questions about your codebase using reactions",
    backgroundColor: "#4A154B",
  },
  reactions: {
    trigger: "robot_face",
    stop: "octagonal_sign",
    queuedFollowup: "eyes",
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

export function loadSlackAuth(): SlackAuthConfig {
  const authPath = resolve(process.cwd(), "data", "auth", "slack.json");

  if (!existsSync(authPath)) {
    throw new Error(
      `Slack auth file not found at ${authPath}.\n` +
        `Run 'npm run docker-setup' or create data/auth/slack.json manually.\n` +
        `See data/auth/slack.example.json for the expected format.`,
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

function parseThinking(
  raw: Record<string, unknown> | undefined,
  fallback?: ThinkingFeedbackConfig,
): ThinkingFeedbackConfig | undefined {
  if (!raw) return fallback;
  const type = str(raw, "type");
  if (type !== "message" && type !== "emoji") return fallback;
  return { type, emoji: str(raw, "emoji") };
}

interface TaskCardsRaw {
  maxDetailsPerGroup?: unknown;
}

function parseMaxRunHistory(val: unknown): number | undefined {
  if (val === undefined) return undefined;
  if (typeof val !== "number" || !Number.isInteger(val) || val < 1) {
    logger.warn(
      `Config 'scheduledMessagesMaxRunHistory' must be a positive integer (got ${JSON.stringify(val)}); falling back to default ${DEFAULT_SCHEDULED_MESSAGES_MAX_RUN_HISTORY}`,
    );
    return undefined;
  }
  return val;
}

function parseTaskCardsConfig(raw: TaskCardsRaw | undefined): TaskCardsConfig | undefined {
  if (!raw) return undefined;
  const val = raw.maxDetailsPerGroup;
  if (val === undefined) return {};
  if (typeof val !== "number" || !Number.isFinite(val) || val < 0 || !Number.isInteger(val)) {
    logger.warn(
      `Config 'taskCards.maxDetailsPerGroup' must be a non-negative integer (got ${JSON.stringify(val)}); falling back to default ${DEFAULT_TASK_CARD_MAX_DETAILS}`,
    );
    return {};
  }
  return { maxDetailsPerGroup: val };
}

function parseTriggerChangesWorkflow(
  raw: Record<string, unknown> | undefined,
): TriggerChangesWorkflowConfig | undefined {
  if (!raw) return undefined;
  return { enabled: bool(raw, "enabled") ?? false };
}

interface ReactionsRaw {
  stop?: unknown;
  queuedFollowup?: unknown;
}

function parseEmojiReaction(
  raw: ReactionsRaw | undefined,
  field: "stop" | "queuedFollowup",
  configPath: string,
): string | null | undefined {
  if (!raw) return undefined;
  if (!(field in raw)) return undefined;
  const val = raw[field];
  if (val === null) return null;
  if (typeof val !== "string") {
    throw new Error(`Config '${configPath}' must be a string or null`);
  }
  if (val.length === 0) return null;
  if (val.includes(":") || /\s/.test(val)) {
    throw new Error(
      `Config '${configPath}' must be an emoji name without colons or whitespace (e.g., 'octagonal_sign', not ':octagonal_sign:')`,
    );
  }
  return val;
}

function parseStopReaction(raw: ReactionsRaw | undefined): string | null | undefined {
  return parseEmojiReaction(raw, "stop", "reactions.stop");
}

function parseQueuedFollowupReaction(raw: ReactionsRaw | undefined): string | null | undefined {
  return parseEmojiReaction(raw, "queuedFollowup", "reactions.queuedFollowup");
}

// JSON value tree for validator inputs — a real type rather than `unknown`.
export type JsonPrimitive = string | number | boolean | null;
export type JsonArray = JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

export function parseMcpServerRegistry(raw: JsonValue | undefined): McpServerRegistry | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Config 'mcpServers' must be an object keyed by server name");
  }

  const entries: JsonObject = raw;
  const registry: McpServerRegistry = {};

  for (const [name, value] of Object.entries(entries)) {
    if (!name || /\s/.test(name)) {
      throw new Error(`Config 'mcpServers' key '${name}' must be a non-empty identifier`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Config 'mcpServers.${name}' must be an object`);
    }
    const entry: JsonObject = value;

    const alwaysLoad = entry.alwaysLoad;
    if (typeof alwaysLoad !== "boolean") {
      throw new Error(`Config 'mcpServers.${name}.alwaysLoad' must be a boolean`);
    }

    const description = entry.description;
    if (typeof description !== "string" || description.trim().length === 0) {
      throw new Error(`Config 'mcpServers.${name}.description' must be a non-empty string`);
    }

    const toolMappingRaw = entry.toolMapping;
    let toolMapping: McpToolMappingOverride | undefined;
    if (toolMappingRaw !== undefined) {
      if (!toolMappingRaw || typeof toolMappingRaw !== "object" || Array.isArray(toolMappingRaw)) {
        throw new Error(`Config 'mcpServers.${name}.toolMapping' must be an object`);
      }
      const tm: JsonObject = toolMappingRaw;
      const tmName = tm.name;
      if (typeof tmName !== "string" || tmName.trim().length === 0 || /\s/.test(tmName)) {
        throw new Error(
          `Config 'mcpServers.${name}.toolMapping.name' must be a non-empty identifier`,
        );
      }
      let tmLabel: string | undefined;
      if (tm.label !== undefined) {
        if (typeof tm.label !== "string" || tm.label.trim().length === 0) {
          throw new Error(
            `Config 'mcpServers.${name}.toolMapping.label' must be a non-empty string`,
          );
        }
        tmLabel = tm.label;
      }
      for (const key of Object.keys(tm)) {
        if (key !== "name" && key !== "label") {
          throw new Error(`Config 'mcpServers.${name}.toolMapping' contains unknown key '${key}'`);
        }
      }
      toolMapping = tmLabel !== undefined ? { name: tmName, label: tmLabel } : { name: tmName };
    }

    registry[name] = toolMapping
      ? { alwaysLoad, description, toolMapping }
      : { alwaysLoad, description };
  }

  return registry;
}

export function parseSkillPluginRegistry(
  raw: JsonValue | undefined,
): SkillPluginRegistry | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Config 'skillPlugins' must be an object keyed by plugin name");
  }

  const entries: JsonObject = raw;
  const registry: SkillPluginRegistry = {};

  for (const [name, value] of Object.entries(entries)) {
    if (!name || /\s/.test(name)) {
      throw new Error(`Config 'skillPlugins' key '${name}' must be a non-empty identifier`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Config 'skillPlugins.${name}' must be an object`);
    }
    const entry: JsonObject = value;

    const lazyLoad = entry.lazyLoad;
    if (typeof lazyLoad !== "boolean") {
      throw new Error(`Config 'skillPlugins.${name}.lazyLoad' must be a boolean`);
    }

    const description = entry.description;
    if (lazyLoad) {
      // Lazy entries render in the catalog — description is required.
      if (typeof description !== "string" || description.trim().length === 0) {
        throw new Error(
          `Config 'skillPlugins.${name}.description' must be a non-empty string when lazyLoad is true`,
        );
      }
      registry[name] = { lazyLoad, description };
    } else {
      // Non-lazy entries never hit the catalog; description is optional but must be a
      // string when provided.
      if (description !== undefined && typeof description !== "string") {
        throw new Error(`Config 'skillPlugins.${name}.description' must be a string if provided`);
      }
      registry[name] = {
        lazyLoad,
        description: typeof description === "string" ? description : "",
      };
    }
  }

  return registry;
}

export function parseSubmitResponseConfig(raw: JsonValue | undefined): SubmitResponseConfig {
  const fallback: SubmitResponseConfig = {
    maxAdditionalMessages: DEFAULT_MAX_ADDITIONAL_MESSAGES,
  };
  if (raw === undefined) return fallback;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Config 'submitResponse' must be an object");
  }

  const entry: JsonObject = raw;
  const maxRaw = entry.maxAdditionalMessages;
  if (maxRaw === undefined) return fallback;

  if (typeof maxRaw !== "number" || !Number.isInteger(maxRaw)) {
    throw new Error("Config 'submitResponse.maxAdditionalMessages' must be an integer");
  }
  if (maxRaw < MAX_ADDITIONAL_MESSAGES_MIN || maxRaw > MAX_ADDITIONAL_MESSAGES_MAX) {
    throw new Error(
      `Config 'submitResponse.maxAdditionalMessages' must be in [${MAX_ADDITIONAL_MESSAGES_MIN}, ${MAX_ADDITIONAL_MESSAGES_MAX}] (got ${maxRaw})`,
    );
  }

  return { maxAdditionalMessages: maxRaw };
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
      `Repository 'mergeStrategy' must be one of: ${VALID_MERGE_STRATEGIES.join(", ")} (got '${value}')`,
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

export function validateConfig(config: unknown, slackAuth: SlackAuthConfig): Config {
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
        throw new Error(
          `Repository '${r.name}' access.read must be one of: ${VALID_ROLES.join(", ")}`,
        );
      }
      const writeVal = acc.write;
      if (writeVal !== undefined && (typeof writeVal !== "string" || !isValidRole(writeVal))) {
        throw new Error(
          `Repository '${r.name}' access.write must be one of: ${VALID_ROLES.join(", ")}`,
        );
      }
    }
  }

  // Validate language if provided
  if (c.language !== undefined && !isSupportedLanguage(c.language)) {
    throw new Error(
      `Config 'language' must be one of: ${SUPPORTED_LANGUAGES.join(", ")} (got ${JSON.stringify(c.language)})`,
    );
  }

  // Validate slackApp if provided
  const slackAppRaw = section(c, "slackApp");
  if (slackAppRaw) {
    if (
      slackAppRaw.name !== undefined &&
      (typeof slackAppRaw.name !== "string" || (slackAppRaw.name as string).length === 0)
    ) {
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
  const autoRespondRaw = section(c, "autoRespond");
  const taskCardsRaw = section(c, "taskCards");
  const gitRaw = section(c, "git");
  const sessionsRaw = section(c, "sessions");
  const claudeCodeRaw = section(c, "claudeCode");
  const cwRaw = section(c, "changesWorkflow");
  // Trivia configuration relocated to data/plugins/trivia/config.json (see
  // src/plugins/trivia/core/configBridge.ts). The trivia plugin owns its own
  // parsing, types, and file I/O — the bot-core loader no longer touches the
  // trivia block. Migration 022 moves any legacy data/config.json.trivia into
  // the new file at boot.
  const reusableFoldersRaw = cwRaw && section(cwRaw, "reusableFolders");
  const reusableFolders: ReusableFoldersConfig | undefined = reusableFoldersRaw
    ? {
        enabled: bool(reusableFoldersRaw, "enabled") ?? false,
        minimumProvisioned: num(reusableFoldersRaw, "minimumProvisioned") ?? 0,
        maxConcurrent: num(reusableFoldersRaw, "maxConcurrent") ?? 3,
        maxQueueDepth: num(reusableFoldersRaw, "maxQueueDepth") ?? 5,
        idleReleaseHours: num(reusableFoldersRaw, "idleReleaseHours") ?? 24,
        dirtyTrackedQuarantine: bool(reusableFoldersRaw, "dirtyTrackedQuarantine") ?? true,
      }
    : undefined;

  // Parse reactions changes workflow (has extra "trigger" field)
  const reactionsChangesWorkflow = reactionsRaw
    ? section(reactionsRaw, "changesWorkflow")
    : undefined;
  const parsedReactionsCW: ReactionsChangesWorkflowConfig | undefined = reactionsChangesWorkflow
    ? {
        enabled: bool(reactionsChangesWorkflow, "enabled") ?? false,
        trigger: str(reactionsChangesWorkflow, "trigger"),
      }
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
      description:
        (slackAppRaw && str(slackAppRaw, "description")) ?? DEFAULTS.slackApp!.description,
      backgroundColor:
        (slackAppRaw && str(slackAppRaw, "backgroundColor")) ?? DEFAULTS.slackApp!.backgroundColor,
    },
    reactions: {
      trigger: (reactionsRaw && str(reactionsRaw, "trigger")) || DEFAULTS.reactions!.trigger,
      stop: parseStopReaction(reactionsRaw),
      queuedFollowup: parseQueuedFollowupReaction(reactionsRaw),
      thinking: parseThinking(
        reactionsRaw && section(reactionsRaw, "thinking"),
        DEFAULTS.reactions!.thinking,
      ),
      changesWorkflow: parsedReactionsCW,
    },
    directMessages: {
      enabled: (dmRaw && bool(dmRaw, "enabled")) ?? DEFAULTS.directMessages!.enabled,
      thinking: parseThinking(
        dmRaw && section(dmRaw, "thinking"),
        DEFAULTS.directMessages!.thinking,
      ),
      changesWorkflow: parseTriggerChangesWorkflow(dmRaw && section(dmRaw, "changesWorkflow")),
    },
    mentions: {
      enabled: (mentionsRaw && bool(mentionsRaw, "enabled")) ?? DEFAULTS.mentions!.enabled,
      thinking: parseThinking(
        mentionsRaw && section(mentionsRaw, "thinking"),
        DEFAULTS.mentions!.thinking,
      ),
      changesWorkflow: parseTriggerChangesWorkflow(
        mentionsRaw && section(mentionsRaw, "changesWorkflow"),
      ),
    },
    autoRespond: autoRespondRaw ? { enabled: bool(autoRespondRaw, "enabled") ?? false } : undefined,
    taskCards: parseTaskCardsConfig(taskCardsRaw as TaskCardsRaw | undefined),
    repositories: c.repositories.map((r: unknown) => parseRepo(r as Record<string, unknown>)),
    git: {
      pullIntervalMinutes:
        (gitRaw && num(gitRaw, "pullIntervalMinutes")) ?? DEFAULTS.git!.pullIntervalMinutes,
      shallowClone: (gitRaw && bool(gitRaw, "shallowClone")) ?? DEFAULTS.git!.shallowClone,
      cloneDepth: (gitRaw && num(gitRaw, "cloneDepth")) ?? DEFAULTS.git!.cloneDepth,
    },
    sessions: {
      cleanupIntervalMinutes:
        (sessionsRaw && num(sessionsRaw, "cleanupIntervalMinutes")) ??
        DEFAULTS.sessions!.cleanupIntervalMinutes,
    },
    claudeCode: {
      model: (claudeCodeRaw && str(claudeCodeRaw, "model")) ?? DEFAULTS.claudeCode!.model,
      watchMcpConfig: (claudeCodeRaw && bool(claudeCodeRaw, "watchMcpConfig")) ?? false,
    },
    changesWorkflow: cwRaw
      ? {
          enabled: bool(cwRaw, "enabled") ?? false,
          timeoutMinutes: num(cwRaw, "timeoutMinutes"),
          additionalAllowedTools: strArray(cwRaw, "additionalAllowedTools"),
          sessionExpiryHours: num(cwRaw, "sessionExpiryHours"),
          monitoringIntervalMinutes: num(cwRaw, "monitoringIntervalMinutes"),
          reusableFolders,
          maxActiveChangesPerUser: num(cwRaw, "maxActiveChangesPerUser"),
        }
      : undefined,
    allowScheduledMessages: bool(c, "allowScheduledMessages") ?? false,
    scheduledMessagesMaxRunHistory: parseMaxRunHistory(c.scheduledMessagesMaxRunHistory),
    threadAutoRespond: bool(c, "threadAutoRespond") ?? undefined,
    threadAutoRespondMaxAgeMinutes: num(c, "threadAutoRespondMaxAgeMinutes") ?? undefined,
    plugins: strArray(c, "plugins"),
    mcpServers: parseMcpServerRegistry(c.mcpServers as JsonValue | undefined),
    skillPlugins: parseSkillPluginRegistry(c.skillPlugins as JsonValue | undefined),
    submitResponse: parseSubmitResponseConfig(c.submitResponse as JsonValue | undefined),
    language: isSupportedLanguage(c.language) ? c.language : undefined,
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
      `Config file not found at ${path}. Copy data/config.example.json to data/config.json and fill in your values.`,
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

/**
 * Resolved cap on detail lines rendered per grouped tool task card,
 * sourced from `config.taskCards.maxDetailsPerGroup` with a built-in
 * fallback when config is missing or unloaded.
 */
export function getTaskCardMaxDetails(): number {
  if (!cachedConfig) return DEFAULT_TASK_CARD_MAX_DETAILS;
  return cachedConfig.taskCards?.maxDetailsPerGroup ?? DEFAULT_TASK_CARD_MAX_DETAILS;
}

/**
 * Resolved cap on per-job `runs[]` history retained by {@link updateJobRunStatus},
 * sourced from `config.scheduledMessagesMaxRunHistory` with a built-in fallback
 * when config is missing or unloaded.
 */
export function getScheduledMessagesMaxRunHistory(): number {
  if (!cachedConfig) return DEFAULT_SCHEDULED_MESSAGES_MAX_RUN_HISTORY;
  return cachedConfig.scheduledMessagesMaxRunHistory ?? DEFAULT_SCHEDULED_MESSAGES_MAX_RUN_HISTORY;
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

export function getStateDir(): string {
  return resolve(getDataDir(), "state");
}

export function findRepoByName(name: string, config: Config): RepositoryConfig | undefined {
  return config.repositories.find((r) => r.name.toLowerCase() === name.toLowerCase());
}
