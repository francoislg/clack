import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { CronExpressionParser } from "cron-parser";
import type { UserRole } from "./roles.js";
import { logger } from "./logger.js";
import { isChannelId } from "./slack/channelResolver.js";

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

export interface TriviaSeasonsConfig {
  enabled: boolean;
  prompt: string;
}

/**
 * Weighted-random map of question type → weight. Weights are non-negative integers;
 * at least one weight MUST be strictly positive. `get_ideas` re-normalizes at roll time.
 * Absent / `{ boolean: 1 }` → pure-boolean behavior (equivalent to pre-choice-questions).
 */
export type TriviaQuestionTypeWeights = Record<"boolean" | "choice", number>;

/**
 * Bounds for the number of options in a `choice` question. Both bounds must satisfy
 * `2 <= min <= max <= 4`. Workspace-only — not season-overridable (purely a card-readability
 * UX setting; gameplay-relevant per-season config lives on the SeasonEntry).
 */
export interface TriviaChoicesConfig {
  min: number;
  max: number;
}

/**
 * One trivia game declared in config. The trivia plugin reconciles its cron jobs from this list
 * on every load: each entry produces two plugin-managed cron jobs (`<name>:question` and `<name>:reveal`).
 */
export interface TriviaGame {
  /** Unique identifier within `games[]`; used in `specKey` so renames diff cleanly. Must match `^[a-z0-9-]+$`, length 1–32. */
  name: string;
  /** Slack channel ID where this game runs (e.g. `C123ABC`). */
  channel: string;
  /** Cron expression for when the daily question is posted. */
  questionCron: string;
  /** Cron expression for when the answer is revealed. */
  revealCron: string;
  /** IANA timezone the cron expressions are interpreted in. */
  timezone: string;
  /** When `false`, the plugin skips this entry during cron reconcile AND per-game write tools refuse. Defaults to `true`. */
  enabled?: boolean;
}

/** Game-name format: filesystem-safe kebab-case, 1–32 chars. */
const TRIVIA_GAME_NAME_RE = /^[a-z0-9-]+$/;

/**
 * One off-day for the trivia plugin. Propagated by the trivia plugin into every cron job's
 * `skipDates` field at reconcile time, where the scheduler evaluates them deterministically
 * before opening a Claude session (see `cronScheduler.executeJob`).
 */
export interface OffDay {
  /**
   * `YYYY-MM-DD` for an exact date, or `MM-DD` for a date that recurs annually. Interpreted
   * in the matching cron job's `timezone` at fire time.
   */
  date: string;
  /** Human-readable label used in logs and (future) Home Tab display. Required, non-empty. */
  label: string;
}

export interface TriviaConfig {
  seasons?: TriviaSeasonsConfig;
  /** Weighted-random map of question type → weight (workspace default; overridable per-season via SeasonEntry.questionTypes). */
  questionsTypes?: TriviaQuestionTypeWeights;
  /** Bounds for choice-question option counts. Defaults to `{ min: 2, max: 4 }`. */
  choices?: TriviaChoicesConfig;
  /**
   * Declarative trivia games. Each entry becomes two plugin-managed cron jobs (question + reveal).
   * The trivia plugin reads this on every init and calls `sdk.reconcileCronJobs("trivia", …)`.
   */
  games?: TriviaGame[];
  /**
   * Plugin-level off-days. Shared by every entry in `games[]` — there is no per-game override.
   * Propagated into each cron job's `skipDates` field at reconcile time.
   */
  offDays?: OffDay[];
}

/** Defaults applied when `trivia.choices` is absent or only partially specified. */
export const DEFAULT_TRIVIA_CHOICES: TriviaChoicesConfig = { min: 2, max: 4 };

export interface TaskCardsConfig {
  /** Default cap on detail lines rendered per grouped tool task card. */
  maxDetailsPerGroup?: number;
}

/** Built-in fallback when neither per-group nor global config sets a cap. */
export const DEFAULT_TASK_CARD_MAX_DETAILS = 5;

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
  /** Auto-respond to thread replies in existing sessions (default: true) */
  threadAutoRespond?: boolean;
  /** Disengage thread auto-respond if the triggering message is older than this many minutes (default: 60) */
  threadAutoRespondMaxAgeMinutes?: number;
  /** List of Clack plugin names to load at startup */
  plugins?: string[];
  /** Trivia plugin configuration (only read when the trivia plugin is in `plugins`) */
  trivia?: TriviaConfig;
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

const QUESTION_TYPE_KEYS = ["boolean", "choice"] as const;

export function parseTriviaQuestionsTypes(
  raw: JsonValue | undefined,
): TriviaQuestionTypeWeights | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Config 'trivia.questionsTypes' must be an object");
  }
  const entries: JsonObject = raw;
  const out: Partial<TriviaQuestionTypeWeights> = {};
  let positiveCount = 0;
  for (const [key, value] of Object.entries(entries)) {
    if (!(QUESTION_TYPE_KEYS as readonly string[]).includes(key)) {
      throw new Error(
        `Config 'trivia.questionsTypes' contains unknown key '${key}' (allowed: ${QUESTION_TYPE_KEYS.join(", ")})`,
      );
    }
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      value < 0
    ) {
      throw new Error(
        `Config 'trivia.questionsTypes.${key}' must be a non-negative integer (got ${JSON.stringify(value)})`,
      );
    }
    out[key as "boolean" | "choice"] = value;
    if (value > 0) positiveCount++;
  }
  if (positiveCount === 0) {
    throw new Error(
      "Config 'trivia.questionsTypes' must have at least one strictly positive weight",
    );
  }
  return {
    boolean: out.boolean ?? 0,
    choice: out.choice ?? 0,
  };
}

export function parseTriviaChoicesConfig(
  raw: JsonValue | undefined,
): TriviaChoicesConfig | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Config 'trivia.choices' must be an object");
  }
  const entries: JsonObject = raw;
  const min = entries.min ?? DEFAULT_TRIVIA_CHOICES.min;
  const max = entries.max ?? DEFAULT_TRIVIA_CHOICES.max;
  if (typeof min !== "number" || !Number.isInteger(min) || min < 2 || min > 4) {
    throw new Error(
      `Config 'trivia.choices.min' must be an integer in [2, 4] (got ${JSON.stringify(min)})`,
    );
  }
  if (typeof max !== "number" || !Number.isInteger(max) || max < 2 || max > 4) {
    throw new Error(
      `Config 'trivia.choices.max' must be an integer in [2, 4] (got ${JSON.stringify(max)})`,
    );
  }
  if (min > max) {
    throw new Error(`Config 'trivia.choices' bounds invalid: min (${min}) > max (${max})`);
  }
  return { min, max };
}

/**
 * Parse and validate `trivia.games[]`. Invalid entries are dropped with a logged warning so a
 * single typo doesn't kill the whole list (mirrors auto-respond / scheduled-message resilience).
 * Returns undefined when the field is absent; returns an empty array when explicitly `[]`.
 */
export function parseTriviaGames(raw: JsonValue | undefined): TriviaGame[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    logger.warn("Config 'trivia.games' must be an array — ignoring");
    return [];
  }

  const out: TriviaGame[] = [];
  const seenNames = new Set<string>();

  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      logger.warn(`Config 'trivia.games[${i}]' must be an object — skipping`);
      continue;
    }
    const e: JsonObject = entry;
    const name = typeof e.name === "string" ? e.name : "";
    const channel = typeof e.channel === "string" ? e.channel : "";
    const questionCron = typeof e.questionCron === "string" ? e.questionCron : "";
    const revealCron = typeof e.revealCron === "string" ? e.revealCron : "";
    const timezone = typeof e.timezone === "string" ? e.timezone : "";

    if (name.length === 0) {
      logger.warn(`Config 'trivia.games[${i}].name' must be a non-empty string — skipping entry`);
      continue;
    }
    if (name.length > 32) {
      logger.warn(
        `Config 'trivia.games[${i}].name' "${name}" exceeds 32 characters — skipping entry`,
      );
      continue;
    }
    if (!TRIVIA_GAME_NAME_RE.test(name)) {
      logger.warn(
        `Config 'trivia.games[${i}].name' "${name}" must match /^[a-z0-9-]+$/ (lowercase, digits, hyphens) — skipping entry`,
      );
      continue;
    }
    if (seenNames.has(name)) {
      logger.warn(`Config 'trivia.games[${i}]' has duplicate name "${name}" — skipping entry`);
      continue;
    }
    if (!isChannelId(channel)) {
      logger.warn(
        `Config 'trivia.games[${i}].channel' "${channel}" is not a Slack channel ID (expected C…/G…/D…) — skipping entry "${name}"`,
      );
      continue;
    }
    try {
      CronExpressionParser.parse(questionCron, { tz: timezone || "UTC" });
    } catch (err) {
      logger.warn(
        `Config 'trivia.games[${i}].questionCron' "${questionCron}" is invalid (${err instanceof Error ? err.message : String(err)}) — skipping entry "${name}"`,
      );
      continue;
    }
    try {
      CronExpressionParser.parse(revealCron, { tz: timezone || "UTC" });
    } catch (err) {
      logger.warn(
        `Config 'trivia.games[${i}].revealCron' "${revealCron}" is invalid (${err instanceof Error ? err.message : String(err)}) — skipping entry "${name}"`,
      );
      continue;
    }
    if (timezone.length === 0) {
      logger.warn(
        `Config 'trivia.games[${i}].timezone' must be a non-empty IANA tz string — skipping entry "${name}"`,
      );
      continue;
    }

    // Optional `enabled` flag: when present, must be boolean; defaults to true when absent.
    let enabled = true;
    if ("enabled" in e && e.enabled !== undefined) {
      if (typeof e.enabled !== "boolean") {
        logger.warn(
          `Config 'trivia.games[${i}].enabled' must be a boolean — skipping entry "${name}"`,
        );
        continue;
      }
      enabled = e.enabled;
    }

    seenNames.add(name);
    out.push({ name, channel, questionCron, revealCron, timezone, enabled });
  }

  return out;
}

/**
 * Days-per-month lookup for off-day date validation. Index = month (1-based, 12 entries plus a
 * leading 0 slot). February uses 29 to accept Feb 29 entries (recurring `MM-DD` form has no year
 * to consult). Date.UTC would also "accept" Feb 30 by rolling forward, so we have to range-check
 * ourselves.
 */
const DAYS_IN_MONTH = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isRealCalendarDate(year: number | null, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  const maxDay = year === null ? DAYS_IN_MONTH[month] : new Date(year, month, 0).getDate();
  return day >= 1 && day <= maxDay;
}

/**
 * Parse and validate `trivia.offDays[]`. Invalid entries are dropped with a logged warning;
 * the rest of the list survives. Matches the warn-and-drop pattern used by `parseTriviaGames`.
 */
export function parseOffDays(raw: JsonValue | undefined): OffDay[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    logger.warn("Config 'trivia.offDays' must be an array — ignoring");
    return [];
  }

  const exactRe = /^(\d{4})-(\d{2})-(\d{2})$/;
  const recurringRe = /^(\d{2})-(\d{2})$/;
  const out: OffDay[] = [];

  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      logger.warn(`Config 'trivia.offDays[${i}]' must be an object — skipping`);
      continue;
    }
    const e: JsonObject = entry;
    const date = typeof e.date === "string" ? e.date : "";
    const label = typeof e.label === "string" ? e.label : "";

    if (date.length === 0) {
      logger.warn(`Config 'trivia.offDays[${i}].date' must be a non-empty string — skipping`);
      continue;
    }

    const exactMatch = exactRe.exec(date);
    const recurringMatch = recurringRe.exec(date);
    if (!exactMatch && !recurringMatch) {
      logger.warn(
        `Config 'trivia.offDays[${i}].date' "${date}" must be YYYY-MM-DD or MM-DD — skipping`,
      );
      continue;
    }

    const year = exactMatch ? Number(exactMatch[1]) : null;
    const month = Number((exactMatch ?? recurringMatch)![exactMatch ? 2 : 1]);
    const day = Number((exactMatch ?? recurringMatch)![exactMatch ? 3 : 2]);
    if (!isRealCalendarDate(year, month, day)) {
      logger.warn(
        `Config 'trivia.offDays[${i}].date' "${date}" is not a real calendar date — skipping`,
      );
      continue;
    }

    if (label.length === 0) {
      logger.warn(`Config 'trivia.offDays[${i}].label' must be a non-empty string — skipping`);
      continue;
    }

    out.push({ date, label });
  }

  return out;
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
type JsonPrimitive = string | number | boolean | null;
type JsonArray = JsonValue[];
interface JsonObject {
  [key: string]: JsonValue;
}
type JsonValue = JsonPrimitive | JsonArray | JsonObject;

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
  const triviaRaw = section(c, "trivia");
  const triviaSeasonsRaw = triviaRaw ? section(triviaRaw, "seasons") : undefined;
  let triviaConfig: TriviaConfig | undefined;
  if (triviaRaw) {
    const questionsTypes = parseTriviaQuestionsTypes(
      triviaRaw.questionsTypes as JsonValue | undefined,
    );
    const choices = parseTriviaChoicesConfig(triviaRaw.choices as JsonValue | undefined);
    const games = parseTriviaGames(triviaRaw.games as JsonValue | undefined);
    const offDays = parseOffDays(triviaRaw.offDays as JsonValue | undefined);
    if (triviaSeasonsRaw) {
      const seasonsEnabled = bool(triviaSeasonsRaw, "enabled") ?? false;
      const seasonsPrompt = str(triviaSeasonsRaw, "prompt") ?? "";
      if (seasonsEnabled && seasonsPrompt.trim().length === 0) {
        logger.warn(
          "Config 'trivia.seasons.enabled' is true but 'trivia.seasons.prompt' is missing — disabling seasons",
        );
        triviaConfig = {
          seasons: { enabled: false, prompt: "" },
          questionsTypes,
          choices,
          games,
          offDays,
        };
      } else {
        triviaConfig = {
          seasons: { enabled: seasonsEnabled, prompt: seasonsPrompt },
          questionsTypes,
          choices,
          games,
          offDays,
        };
      }
    } else {
      triviaConfig = { questionsTypes, choices, games, offDays };
    }
  }
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
    threadAutoRespond: bool(c, "threadAutoRespond") ?? undefined,
    threadAutoRespondMaxAgeMinutes: num(c, "threadAutoRespondMaxAgeMinutes") ?? undefined,
    plugins: strArray(c, "plugins"),
    trivia: triviaConfig,
    mcpServers: parseMcpServerRegistry(c.mcpServers as JsonValue | undefined),
    skillPlugins: parseSkillPluginRegistry(c.skillPlugins as JsonValue | undefined),
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
