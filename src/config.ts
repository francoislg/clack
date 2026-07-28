import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { UserRole } from "./roles.js";
import { type Lang } from "./i18n/languages.js";
import { validateConfig } from "./configZod.js";

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
  /** Model for worker-mode (worktree) runs. Falls back to `model` when unset. */
  workerModel?: string;
  /** Model for the auto-respond pre-analysis classifier. Falls back to `"sonnet"` when unset. */
  preAnalysisModel?: string;
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
  /**
   * When true, Clack requests reviewers (chosen by Claude's judgement) on PRs it opens in
   * worker mode. Default false. Intent only — reviewer-request failures never fail PR creation.
   */
  requirePRReviewers?: boolean;
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

/**
 * Which Slack DM transport to use. `"assistant"` (default) registers a Bolt
 * `Assistant` instance against the Agents & Assistants API. `"classic"` instead
 * registers a low-level `app.event("message")` listener filtered on
 * `channel_type === "im"`. The two are mutually exclusive at registration —
 * switching requires a restart AND a manifest re-upload because the subscribed
 * bot events differ.
 */
export type DmType = "assistant" | "classic" | "agent";

export const VALID_DM_TYPES: readonly DmType[] = ["assistant", "classic", "agent"] as const;

export interface DirectMessagesConfig {
  enabled: boolean;
  dmType: DmType;
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

export interface AssistantSuggestedPrompt {
  title: string;
  message: string;
}

/**
 * Optional overrides for the Slack Assistant pane's first-contact UI: the greeting
 * message and the suggested-prompt chips. When a field is absent, the built-in
 * `t("assistant.*")` defaults are used. `suggestedPrompts` fully replaces the default
 * prompt set (Slack caps suggested prompts at 4).
 */
export interface AssistantPaneConfig {
  greeting?: string;
  suggestedPrompts?: AssistantSuggestedPrompt[];
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
 * Toggle for the user-created skills feature. When `enabled` is `false` (or the block
 * is absent), the feature is fully inert: MCP tools (`propose_skill_*`, `list_user_skills`)
 * are not registered, the prompt's "USER SKILLS" subsection is not rendered, the Home Tab
 * Skills section is hidden, and `data/user-skills/` is ignored. Toggling via `data/config.json`
 * picks itself up through the existing lifecycle reload — no extra wiring needed.
 */
export interface UserSkillsConfig {
  enabled: boolean;
}

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

/**
 * Admin-specific tuning. `additionalWords` extends the built-in admin-claim keyword list used by
 * the prompt's admin-deference posture (see `messageClaimsAdmin`). Entries are normalized
 * (trimmed, lowercased, curly apostrophes straightened) and deduped at parse time.
 */
export interface AdminConfig {
  /** Extra keywords that, in a user's latest message, count as invoking admin authority. */
  additionalWords: string[];
}

/**
 * Cron scheduler + user-facing scheduling-tool configuration.
 *
 * - `enabled` (default `true`) gates the cron tick loop. When `false`, no job —
 *   user-created or plugin-managed — fires. Plugins that depend on the scheduler
 *   (e.g. trivia) inspect `sdk.capabilities.crons` and refuse to load.
 * - `userSchedules` (default `false`) gates the user-facing scheduling MCP tools
 *   (`create_scheduled_message`, reminders, etc.) and the Home Tab's user-schedules
 *   subsection. Independent of `enabled` — turning user schedules off does not stop
 *   plugin crons.
 * - `maxRunHistory` is the per-job runs[] cap, formerly `scheduledMessagesMaxRunHistory`.
 */
export interface CronConfig {
  enabled?: boolean;
  userSchedules?: boolean;
  maxRunHistory?: number;
  catchUp?: CronCatchUpConfig;
}

/**
 * Boot-time catch-up settings. `delayMinutes` is the settle window between the cron
 * scheduler starting and the delayed-boot plugin hooks being dispatched (integer ≥ 0;
 * `0` dispatches on the next event-loop tick — useful in tests). Default 3.
 */
export interface CronCatchUpConfig {
  delayMinutes?: number;
}

/**
 * Daily state-backup settings. A dedicated midnight scheduler (independent of the cron-job
 * system) copies the configured `folders` into `data/backups/{YYYY-MM-DD}/<folder>/`. Fully
 * inert when `enabled` is false. See {@link getBackupConfig} and `src/stateBackup.ts`.
 *
 * - `enabled` (default `true`) gates the whole feature — no scheduler, no writes when false.
 * - `folders` (default `["state"]`) are paths relative to `data/`. The copy routine iterates
 *   the list, so backing up additional folders later is a config change, not a code change.
 * - `timezone` (default `"America/Montreal"`) sets both the midnight fire and the `{date}` label.
 *
 * Fail-fast at boot (see `backupZod`): an invalid IANA `timezone` or an unsafe `folders` entry
 * (`""`, `"."`, absolute, or resolving into the backup tree) throws rather than degrading.
 */
export interface BackupConfig {
  enabled: boolean;
  folders: string[];
  timezone: string;
}

export const DEFAULT_BACKUP_TIMEZONE = "America/Montreal";
export const DEFAULT_BACKUP_FOLDERS: readonly string[] = ["state"];

/**
 * Tester feature ("test this PR" runs). Fully inert when absent or `enabled: false`:
 * the `run_test` action tool is not registered, no tester toolbelt exists, and no
 * Home Tab surface renders. When enabled, a tester run drives the app under test via
 * the Playwright MCP server running in the opt-in sidecar container.
 */
export interface TesterConfig {
  enabled: boolean;
  /**
   * URL of the Playwright MCP sidecar's HTTP endpoint, e.g.
   * "http://clack-playwright:8931/mcp". Required when `enabled` is true.
   */
  sidecarUrl?: string;
  /**
   * Directory where the sidecar writes session recordings — the shared volume's
   * mount point in THIS container. Required when `enabled` is true.
   */
  recordingsDir?: string;
  /**
   * Hostname of the main Clack container AS SEEN FROM THE SIDECAR (the shared Docker
   * network name the sidecar's browser uses to reach the app under test). Default "clack".
   */
  appHost?: string;
  /** Max simultaneous tester runs (each adds a browser + the app dev server). Default 1. */
  maxConcurrent?: number;
  /**
   * URL of the restricted docker-socket-proxy the service lifecycle talks to, e.g.
   * "http://clack-docker-proxy:2375". Workspace-wide (one proxy serves all repos).
   * Required at run time only when the target repo declares tester services.
   */
  dockerProxyUrl?: string;
  /**
   * Ceiling on the summed `memoryMb` of a repo's declared tester services. A run whose
   * declared services exceed this budget aborts before anything is provisioned. The
   * deploy scripts reserve this amount out of the clack container's memory cap. Default 0
   * (no services can run until an operator sets a budget).
   */
  servicesBudgetMb?: number;
  /**
   * Exact-match allowlist of images tester services may run (e.g. ["mysql:8", "redis:7"]).
   * A declared service whose image is not listed aborts the run before any pull.
   */
  serviceImageAllowlist?: string[];
}

export const DEFAULT_TESTER_APP_HOST = "clack";

export const DEFAULT_TESTER_MAX_CONCURRENT = 1;

export interface Config {
  slack: SlackConfig;
  slackApp?: SlackAppConfig;
  reactions: ReactionsConfig;
  directMessages: DirectMessagesConfig;
  mentions: MentionsConfig;
  autoRespond?: AutoRespondConfig;
  /**
   * Optional overrides for the Slack Assistant pane greeting and suggested prompts.
   * Absent → built-in i18n defaults. See {@link AssistantPaneConfig}.
   */
  assistant?: AssistantPaneConfig;
  taskCards?: TaskCardsConfig;
  repositories: RepositoryConfig[];
  git: GitConfig;
  sessions: SessionsConfig;
  claudeCode: ClaudeCodeConfig;
  changesWorkflow?: ChangesWorkflowConfig;
  /**
   * Cron scheduler + user-facing scheduling tools. Replaces the legacy top-level
   * `allowScheduledMessages` and `scheduledMessagesMaxRunHistory` fields (boot
   * migration rewrites them on first start). See {@link CronConfig}.
   */
  cron?: CronConfig;
  /** Daily state-backup settings. Always populated by validateConfig; see {@link BackupConfig}. */
  backup?: BackupConfig;
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
   * Toggle for the user-created skills feature. Off (or absent) → fully inert. See
   * `UserSkillsConfig` for what "enabled" turns on.
   */
  userSkills?: UserSkillsConfig;
  /**
   * Per-installation tuning for `submit_response`. Currently only carries the
   * `maxAdditionalMessages` cap. Absent → defaults applied at parse time.
   */
  submitResponse?: SubmitResponseConfig;
  /**
   * Admin-specific tuning. Currently only carries `additionalWords` (extra admin-claim keywords).
   * Absent → only the built-in keyword list applies.
   */
  admin?: AdminConfig;
  /**
   * Tester feature ("test this PR"). Absent or disabled → fully inert. See {@link TesterConfig}.
   */
  tester?: TesterConfig;
  /**
   * Opt-in workspace-wide keyword search. When `true`, the generated manifest requests the
   * `search:read.public` bot scope and the `search_messages` query tool is registered.
   * Enabling requires re-uploading the manifest AND reinstalling the app to the workspace
   * (a bot token does not retroactively gain scopes). Absent → `false`, fully inert.
   */
  allowPublicSearch?: boolean;
  /**
   * Workspace-global user-facing language. BCP-47 short code. When absent or `"en"`,
   * the bot behaves identically to its pre-localization state. When set to `"fr"`,
   * `t()`-rendered UI strings and Claude's user-facing output flip to French.
   */
  language?: Lang;
}

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

// JSON value tree for validator inputs — a real type rather than `unknown`.
export type JsonPrimitive = string | number | boolean | null;
export type JsonArray = JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

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
 * sourced from `config.cron.maxRunHistory` with a built-in fallback when config is
 * missing or unloaded.
 */
export function getCronMaxRunHistory(): number {
  if (!cachedConfig) return DEFAULT_SCHEDULED_MESSAGES_MAX_RUN_HISTORY;
  return cachedConfig.cron?.maxRunHistory ?? DEFAULT_SCHEDULED_MESSAGES_MAX_RUN_HISTORY;
}

const DEFAULT_CRON_CATCH_UP_DELAY_MINUTES = 3;

/**
 * Resolved settle delay (minutes) between cron-scheduler start and delayed-boot hook
 * dispatch, sourced from `config.cron.catchUp.delayMinutes` with a built-in fallback
 * when config is missing or unloaded.
 */
export function getCronCatchUpDelayMinutes(): number {
  if (!cachedConfig) return DEFAULT_CRON_CATCH_UP_DELAY_MINUTES;
  return cachedConfig.cron?.catchUp?.delayMinutes ?? DEFAULT_CRON_CATCH_UP_DELAY_MINUTES;
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

/**
 * Absolute path to the optional operator-provided worker settings file. It is a native
 * Claude Code `settings.json` (pure SDK shape, a sibling of `data/mcp.json`) forwarded to
 * worker-mode Claude via the Agent SDK `settings` option, letting operators attach external
 * PreToolUse command hooks and `permissions.deny` rules without any tool-specific code.
 * Absent → worker runs in SDK isolation mode exactly as before.
 */
export function getWorkerSettingsPath(): string {
  return resolve(getDataDir(), "worker-settings.json");
}

/**
 * Extra admin-claim keywords from `config.admin.additionalWords`, or `[]` when config is unloaded
 * or the section is absent. Null-safe (does not throw) so prompt assembly can call it in any
 * context, including tests that never load config.
 */
export function getAdditionalAdminWords(): readonly string[] {
  return cachedConfig?.admin?.additionalWords ?? [];
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

export function getBackupsDir(): string {
  return resolve(getDataDir(), "backups");
}

/**
 * Resolved daily-backup config, or built-in defaults when config is unloaded or the section
 * is absent. Null-safe (does not throw) so the scheduler and tests can call it in any context.
 */
export function getBackupConfig(): BackupConfig {
  return (
    cachedConfig?.backup ?? {
      enabled: true,
      folders: [...DEFAULT_BACKUP_FOLDERS],
      timezone: DEFAULT_BACKUP_TIMEZONE,
    }
  );
}

/**
 * Host-shared location for spinoff slice patches. A patch captured by one worktree's
 * `propose_spinoff` is applied by the sibling's worktree; both live on the same host
 * filesystem under `data/`, so a shared dir here is reachable by both.
 */
export function getSpinoffPatchesDir(): string {
  return resolve(getDataDir(), "spinoff-patches");
}

export function findRepoByName(name: string, config: Config): RepositoryConfig | undefined {
  return config.repositories.find((r) => r.name.toLowerCase() === name.toLowerCase());
}
