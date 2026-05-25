import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, mkdirSync, watch as fsWatch, type FSWatcher } from "node:fs";
import { join, normalize, isAbsolute } from "node:path";
import {
  createSdkMcpServer,
  type SdkMcpToolDefinition,
  type AnyZodRawShape,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import type { App } from "@slack/bolt";
import { CronExpressionParser } from "cron-parser";
import { loadRoles, type UserRole } from "../roles.js";
import type { RoleDir } from "../cascadingConfigResolver.js";
import type { ToolEntryObject } from "../streaming/toolMappingLoader.js";
import { openDmChannel, isChannelId } from "../slack/channelResolver.js";
import { logger as coreLogger } from "../logger.js";
import { getSlackClient as defaultGetSlackClient } from "../slack/app.js";
import { unfurlOptions } from "../slack/unfurlOptions.js";
import type { PluginActionHandler, PluginViewHandler } from "../slack/pluginActionRegistry.js";
import { logger } from "../logger.js";
import { findByPluginOwner, createJob, updateJob, deleteJob, type SkipDate } from "../cronJobs.js";
import { clackQuery as defaultClackQuery } from "../claude/query.js";
import { detectRuntime } from "../claude/utilities.js";

// ============================================================================
// Types
// ============================================================================

/** Tool mapping entry — same format as tool_mapping JSON config entries. */
export type ToolMapping = string | ToolEntryObject;

/** Optional registration knobs for `registerTool`. */
export interface RegisterToolOptions {
  /**
   * Hide the tool unless `session.attachedIntegrations` contains this name. The name MUST
   * match a catalog entry — either a `data/config.json` `mcpServers` entry or a plugin's
   * `sdk.registerIntegration(name, ...)` declaration — so `attach_integration(name)` validates.
   */
  integration?: string;
}

/** Plugin-declared catalog-only integration. Merged into the effective MCP registry at boot. */
export interface PluginIntegration {
  name: string;
  description: string;
  alwaysLoad: boolean;
}

/**
 * Single-turn Claude call routed through `clackQuery` — inherits the
 * deployment's auth (OAuth or API key) the same way every other lightweight
 * Haiku call in Clack does.
 */
export interface AskClaudeOptions {
  model: string;
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  /** No-op; the Agent SDK doesn't expose a per-call output cap. */
  max_tokens?: number;
  /** No-op; the Agent SDK doesn't expose temperature on `query`. */
  temperature?: number;
}

export interface AskClaudeResult {
  text: string;
  /** `"end_turn"` on success; otherwise the result subtype (e.g. `"error_max_turns"`). */
  stopReason: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Declarative shape of a cron job a plugin wants to own. Passed to {@link ClackSdk.reconcileCronJobs}.
 * `specKey` is a stable identity within the plugin owner — reconcile updates existing jobs in place
 * when (plugin === ownerKey, specKey === spec.specKey) matches.
 */
export interface CronJobSpec {
  specKey: string;
  cronExpression: string;
  channel: string;
  prompt: string;
  timezone: string;
  /**
   * Optional 1-80 character human-readable label for the schedule. Surfaced in the Home Tab
   * row and in tool-call task cards via `{name|id}` interpolation. Purely decorative — never
   * used as a lookup key. When present and valid, threaded through to the persisted
   * `CronJob.name` field on both new entries and in-place updates. When absent, the existing
   * persisted value is left untouched on updates and absent on new entries.
   */
  name?: string;
  requiredTools?: string[];
  skipConditions?: string;
  /**
   * Declarative override of the `submit_response` schema/gating behavior. See
   * `CronJob.submitResponseMode` for the full contract. Omit to leave the resulting
   * `CronJob.submitResponseMode` unset (today's auto-derivation rules apply).
   */
  submitResponseMode?: "always" | "optional" | "skipped";
  /**
   * Structured calendar-date skip list. Propagated as-is into the resulting `CronJob.skipDates`.
   * Omit (or pass an empty array) to leave the job's `skipDates` unset.
   */
  skipDates?: SkipDate[];
  /**
   * Topic names that SHALL be pre-attached to the Claude session when this job fires.
   * Pre-attached topics surface their `topics/<topic>/*.md` instruction files (including
   * plugin virtual defaults registered via `addTopicInstruction`) in the system prompt
   * from the first turn — Claude does not need to call `attach_integration`. Omit (or
   * pass an empty array) to leave the resulting `CronJob.attachedTopics` unset.
   * See the `plugin-topic-instructions` capability.
   */
  attachedTopics?: string[];
}

/**
 * Plugin-scoped structured logger. Each level prefixes log lines with the plugin name
 * (e.g. `[trivia]`) so cross-plugin logs are easy to filter. Plugins MUST use this
 * rather than importing the core logger module directly — the plugin SDK is the
 * one-and-only allowed import surface for plugin code.
 */
export interface PluginLogger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface ClackSdk {
  /**
   * Plugin-scoped logger. Prefixes every line with `[<pluginName>]` for filterability.
   * Use this instead of importing the core `logger` module from `src/logger.ts` —
   * direct imports from outside the SDK are not allowed in plugin code.
   */
  logger: PluginLogger;
  addInstruction(role: RoleDir, filename: string, content: string): void;
  /**
   * Register topic-scoped instruction content. The file is stored as a virtual default at
   * `topics/<topic>/<pluginName>__<filename>.md` and is loaded only when the named topic is
   * active for a session — either pre-attached via `CronJobSpec.attachedTopics` or runtime-
   * attached via `attach_integration`. Admins override by placing a file at
   * `data/configuration/<role>/topics/<topic>/<pluginName>__<filename>.md` (same precedence
   * rule as baseline plugin instruction overrides). See the `plugin-topic-instructions`
   * capability for full semantics.
   */
  addTopicInstruction(role: RoleDir, topic: string, filename: string, content: string): void;
  /**
   * Register an MCP tool with a minimum role requirement and a Slack task card mapping.
   * Pass `{ integration }` in `options` to gate the tool behind `attach_integration(name)`.
   * @param mapping — Display label for Slack task cards. Either a template string with `{argName}` interpolation,
   *   or an object with `label`, optional `group`, and optional `itemDetail`.
   */
  registerTool<T extends AnyZodRawShape>(
    minRole: UserRole,
    tool: SdkMcpToolDefinition<T>,
    mapping: ToolMapping,
    options?: RegisterToolOptions,
  ): void;
  /**
   * Declare a catalog-only virtual integration owned by this plugin. The name is what Claude
   * passes to `attach_integration(name)`; the description appears in the AVAILABLE INTEGRATIONS
   * catalog. By convention `name` is `<pluginName>:<key>` (e.g. `trivia:management`), mirroring
   * the `<game>:<event>` shape used by cron specKeys. No MCP server is started — plugin-declared
   * integrations are purely catalog entries that gate plugin-registered topic instructions and
   * topic-gated tools.
   */
  registerIntegration(name: string, options: { description: string; alwaysLoad?: boolean }): void;
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
  /**
   * Watch a file under this plugin's data directory. The callback fires (debounced 500ms)
   * whenever the file changes. The returned watcher is tracked on the plugin's load result
   * and closed automatically when the plugin is reloaded by `restartAll`.
   */
  watchFile(relativePath: string, callback: () => void): FSWatcher;
  /**
   * Declaratively reconcile this plugin's owned cron jobs against `specs`. Diffs against
   * existing jobs matching `(plugin === ownerKey, pluginManaged === true)`: upserts entries
   * matched by `specKey` (preserving `id`/`runs[]`/`enabled`/`lastRunAt`/`lastRunStatus`),
   * creates new specs, and deletes owner-jobs whose `specKey` is not in `specs`.
   * Invalid specs (unparseable cron, malformed channel) are skipped with a logged warning;
   * valid neighbors still apply.
   */
  reconcileCronJobs(ownerKey: string, specs: CronJobSpec[]): Promise<void>;
  /**
   * Send a DM to the deployment owner (the user with the `owner` role).
   *
   * Resolved server-side: the owner ID is read from roles, the DM channel is opened
   * via `conversations.open`, and the message is posted via `chat.postMessage`. The
   * recipient is decided here (not by Claude) — this is the safe path for plugins
   * that need to notify the owner without exposing user-targeted DMing as a tool
   * surface to Claude.
   *
   * Pass `{ suppressUnfurls: true }` to disable Slack's link/media unfurling on
   * the resulting message (sets both `unfurl_links: false` and `unfurl_media: false`).
   */
  dmOwner(
    text: string,
    options?: { suppressUnfurls?: boolean },
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Lazily resolves the Slack WebClient at call time. Returns `null` when Slack
   * hasn't connected yet (e.g. plugin tools created at plugin-load time, before
   * the bot's socket session is up). Plugin authors needing direct Slack API access
   * (e.g. `conversations.history` to read message reactions) should call this from
   * inside their tool handler — never close over the result at module top-level.
   */
  getSlackClient(): App["client"] | null;
  /**
   * Register a Slack action handler scoped to this plugin. The `key` is the
   * suffix the plugin owns; the SDK prefixes it as `plugin:<pluginName>:<key>`
   * before recording the handler. Pass a string for an exact-match suffix or a
   * RegExp for a pattern (whose `^` is stripped before splicing the prefix).
   *
   * @example
   * sdk.registerAction("answer", async ({ ack, body, client }) => {
   *   await ack();
   *   // open a modal etc.
   * });
   * // → Slack action_id `plugin:trivia:answer` is now routed to this handler
   */
  registerAction(key: string | RegExp, handler: PluginActionHandler): void;
  /**
   * Register a Slack view-submission handler scoped to this plugin. The `key`
   * is the suffix; the SDK prefixes it as `plugin:<pluginName>:<key>` to form
   * the modal's `callback_id`.
   *
   * @example
   * sdk.registerView("freeform-modal", async ({ ack, view, body }) => {
   *   await ack();
   *   // process modal submission
   * });
   */
  registerView(key: string | RegExp, handler: PluginViewHandler): void;
  /**
   * Returns the full prefixed Slack action_id for a plugin-owned key, e.g.
   * `plugin:trivia:answer`. Use this when building Block Kit payloads so the
   * `action_id` matches the matcher the wildcard dispatcher routes on.
   */
  actionId(key: string): string;
  /**
   * Returns the full prefixed Slack modal `callback_id` for a plugin-owned key,
   * e.g. `plugin:trivia:freeform-modal`. Use this when calling `views.open`.
   */
  viewCallbackId(key: string): string;
  /** Single-turn Claude call routed through the Agent SDK's `query`. */
  askClaude(opts: AskClaudeOptions): Promise<AskClaudeResult>;
}

export type ClackPlugin = (sdk: ClackSdk) => Promise<void>;

export interface RegisteredInstruction {
  role: RoleDir;
  filename: string;
  content: string;
}

/**
 * A registered tool with its minimum role requirement.
 * The `name` field is extracted for duplicate detection.
 * `pushTo` appends the tool to a heterogeneous array (handles the generic cast internally).
 */
export interface RegisteredTool {
  name: string;
  minRole: UserRole;
  integration?: string;
  pushTo: (target: SdkMcpToolDefinition<AnyZodRawShape>[]) => void;
}

/**
 * Captured Slack interactivity registrations. Persisted on the load result so the
 * lifecycle layer can clear them from the central registry on plugin reload before
 * the new init re-registers fresh entries.
 */
export interface RegisteredActionEntry {
  key: string | RegExp;
  handler: PluginActionHandler;
}

export interface RegisteredViewEntry {
  key: string | RegExp;
  handler: PluginViewHandler;
}

export interface PluginLoadResult {
  name: string;
  instructions: RegisteredInstruction[];
  tools: RegisteredTool[];
  /** Plugin-declared catalog integrations, merged into the effective MCP registry at boot. */
  integrations: PluginIntegration[];
  /** Tool name → mapping entry for Slack task cards. */
  toolMappings: Map<string, ToolMapping>;
  /** Dedicated MCP server hosting this plugin's tools, namespaced under the plugin's name. */
  mcpServer: McpSdkServerConfigWithInstance;
  /**
   * Filesystem watchers registered via `sdk.watchFile`. Closed by the plugin reload
   * pipeline (in `lifecycle.ts`) before the plugin's init is re-run, to prevent
   * cross-generation double-fires. Optional — absent in fixture-style load results that
   * do not exercise the watch API.
   */
  watchers?: FSWatcher[];
  /**
   * Slack action handlers registered via `sdk.registerAction`. The lifecycle layer
   * passes each entry into the plugin action registry on load, and clears every
   * entry owned by this plugin on reload before re-running its init.
   */
  actionHandlers: RegisteredActionEntry[];
  /** Slack view-submission handlers registered via `sdk.registerView`. */
  viewHandlers: RegisteredViewEntry[];
}

// ============================================================================
// Path validation
// ============================================================================

function validateRelativePath(path: string): void {
  if (isAbsolute(path)) {
    throw new Error(`Absolute paths are not allowed: ${path}`);
  }
  const normalized = normalize(path);
  if (normalized.startsWith("..")) {
    throw new Error(`Path traversal is not allowed: ${path}`);
  }
}

// ============================================================================
// SDK Factory
// ============================================================================

export interface ClackSdkDeps {
  /** Lazy getter — plugins load before the Slack client is connected, so this is called at tool-invocation time. */
  getSlackClient: () => App["client"] | null;
  loadRoles: typeof loadRoles;
  openDmChannel: typeof openDmChannel;
  /** Cron job persistence — optional in tests that don't exercise reconcile. */
  findByPluginOwner?: typeof findByPluginOwner;
  createJob?: typeof createJob;
  updateJob?: typeof updateJob;
  deleteJob?: typeof deleteJob;
  clackQuery: typeof defaultClackQuery;
}

export const defaultClackSdkDeps: ClackSdkDeps = {
  getSlackClient: defaultGetSlackClient,
  loadRoles,
  openDmChannel,
  findByPluginOwner,
  createJob,
  updateJob,
  deleteJob,
  clackQuery: defaultClackQuery,
};

const WATCH_DEBOUNCE_MS = 500;

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

function validateCronJobSpec(spec: CronJobSpec): string | null {
  if (typeof spec.specKey !== "string" || spec.specKey.length === 0) {
    return "specKey must be a non-empty string";
  }
  if (typeof spec.channel !== "string" || !isChannelId(spec.channel)) {
    return `channel "${spec.channel}" is not a valid Slack channel ID (expected C…/G…/D…)`;
  }
  if (typeof spec.cronExpression !== "string" || spec.cronExpression.length === 0) {
    return "cronExpression must be a non-empty string";
  }
  try {
    CronExpressionParser.parse(spec.cronExpression, { tz: spec.timezone });
  } catch (err) {
    return `cronExpression "${spec.cronExpression}" is invalid: ${err instanceof Error ? err.message : String(err)}`;
  }
  if (typeof spec.timezone !== "string" || spec.timezone.length === 0) {
    return "timezone must be a non-empty IANA tz string";
  }
  if (typeof spec.prompt !== "string" || spec.prompt.length === 0) {
    return "prompt must be a non-empty string";
  }
  if (spec.name !== undefined) {
    if (typeof spec.name !== "string") {
      return "name must be a string when provided";
    }
    const trimmed = spec.name.trim();
    if (trimmed.length === 0 || trimmed.length > 80) {
      return `name must be 1-80 characters after trim (got ${trimmed.length})`;
    }
  }
  return null;
}

export function createClackSdk(
  pluginName: string,
  dataDir: string,
  deps: ClackSdkDeps = defaultClackSdkDeps,
): {
  sdk: ClackSdk;
  harvest: () => PluginLoadResult;
} {
  const instructions: RegisteredInstruction[] = [];
  const tools: RegisteredTool[] = [];
  const integrations: PluginIntegration[] = [];
  const toolMappings = new Map<string, ToolMapping>();
  const watchers: FSWatcher[] = [];
  const actionHandlers: RegisteredActionEntry[] = [];
  const viewHandlers: RegisteredViewEntry[] = [];
  const pluginDataDir = join(dataDir, pluginName);
  const pluginPrefix = `plugin:${pluginName}:`;

  function buildFullKey(key: string | RegExp): string | RegExp {
    if (typeof key === "string") {
      if (key.startsWith("plugin:")) {
        throw new Error(
          `Plugin "${pluginName}" attempted to register a key starting with "plugin:" ("${key}"). The SDK auto-prefixes; pass only the suffix.`,
        );
      }
      return pluginPrefix + key;
    }
    if (key.source.startsWith("plugin:") || key.source.startsWith("^plugin:")) {
      throw new Error(
        `Plugin "${pluginName}" attempted to register a RegExp whose source starts with "plugin:" (source: "${key.source}"). The SDK auto-prefixes; the source should match the suffix only.`,
      );
    }
    const cleaned = key.source.replace(/^\^/, "");
    return new RegExp("^" + pluginPrefix + cleaned, key.flags);
  }

  const pluginLogPrefix = `[${pluginName}]`;
  const pluginLogger: PluginLogger = {
    debug: (...args) => coreLogger.debug(pluginLogPrefix, ...args),
    info: (...args) => coreLogger.info(pluginLogPrefix, ...args),
    warn: (...args) => coreLogger.warn(pluginLogPrefix, ...args),
    error: (...args) => coreLogger.error(pluginLogPrefix, ...args),
  };

  const sdk: ClackSdk = {
    logger: pluginLogger,
    addInstruction(role: RoleDir, filename: string, content: string): void {
      const prefixedFilename = `${pluginName}__${filename}.md`;
      instructions.push({ role, filename: prefixedFilename, content });
    },

    addTopicInstruction(role: RoleDir, topic: string, filename: string, content: string): void {
      const key = `topics/${topic}/${pluginName}__${filename}.md`;
      instructions.push({ role, filename: key, content });
    },

    registerTool<T extends AnyZodRawShape>(
      minRole: UserRole,
      toolDef: SdkMcpToolDefinition<T>,
      mapping: ToolMapping,
      options?: RegisterToolOptions,
    ): void {
      tools.push({
        name: toolDef.name,
        minRole,
        integration: options?.integration,
        // Capture the tool in a closure that pushes it to the target array.
        // This avoids storing it with an incompatible generic type.
        pushTo: (target) => target.push(toolDef as SdkMcpToolDefinition<AnyZodRawShape>),
      });
      toolMappings.set(toolDef.name, mapping);
    },

    registerIntegration(
      name: string,
      options: { description: string; alwaysLoad?: boolean },
    ): void {
      integrations.push({
        name,
        description: options.description,
        alwaysLoad: options.alwaysLoad ?? false,
      });
    },

    async readFile(path: string): Promise<string | null> {
      validateRelativePath(path);
      const fullPath = join(pluginDataDir, path);
      try {
        return await readFile(fullPath, "utf-8");
      } catch {
        return null;
      }
    },

    async writeFile(path: string, content: string): Promise<void> {
      validateRelativePath(path);
      const fullPath = join(pluginDataDir, path);
      const parentDir = join(fullPath, "..");
      if (!existsSync(parentDir)) {
        await mkdir(parentDir, { recursive: true });
      }
      await writeFile(fullPath, content, "utf-8");
    },

    watchFile(path: string, callback: () => void): FSWatcher {
      validateRelativePath(path);
      const fullPath = join(pluginDataDir, path);
      const debounced = debounce(callback, WATCH_DEBOUNCE_MS);
      let watcher: FSWatcher;
      if (existsSync(fullPath)) {
        watcher = fsWatch(fullPath, debounced);
      } else {
        const parentDir = join(fullPath, "..");
        const base = path.split("/").pop() ?? "";
        if (existsSync(parentDir)) {
          watcher = fsWatch(parentDir, (_event, filename) => {
            if (filename === base) debounced();
          });
        } else {
          // Parent dir doesn't exist yet. Attach to the plugin data dir as a no-op so callers
          // always get back an FSWatcher; the contract is "missing file does not throw."
          if (!existsSync(pluginDataDir)) {
            try {
              mkdirSync(pluginDataDir, { recursive: true });
            } catch {
              /* best-effort */
            }
          }
          watcher = fsWatch(pluginDataDir, () => {
            /* no-op until parent/file exists */
          });
        }
      }
      watcher.on("error", (err) => {
        logger.warn(`[plugin:${pluginName}] watchFile("${path}") watcher error:`, err);
      });
      watchers.push(watcher);
      return watcher;
    },

    async reconcileCronJobs(ownerKey: string, specs: CronJobSpec[]): Promise<void> {
      if (typeof ownerKey !== "string" || ownerKey.length === 0) {
        throw new Error("reconcileCronJobs: ownerKey must be a non-empty string");
      }
      if (!Array.isArray(specs)) {
        throw new Error("reconcileCronJobs: specs must be an array");
      }

      // Validate every spec up front. Invalid ones are logged + skipped: they neither create
      // nor delete a job, so any existing job that matched their specKey is left untouched.
      const validSpecs: CronJobSpec[] = [];
      const invalidSpecKeys = new Set<string>();
      for (const spec of specs) {
        const err = validateCronJobSpec(spec);
        if (err) {
          const label = spec.specKey || "<no-spec-key>";
          logger.warn(
            `[plugin:${pluginName}] reconcileCronJobs: skipping invalid spec "${label}": ${err}`,
          );
          if (spec.specKey) invalidSpecKeys.add(spec.specKey);
          continue;
        }
        validSpecs.push(spec);
      }

      const find = deps.findByPluginOwner ?? findByPluginOwner;
      const create = deps.createJob ?? createJob;
      const update = deps.updateJob ?? updateJob;
      const remove = deps.deleteJob ?? deleteJob;

      const existing = await find(ownerKey);
      const existingBySpecKey = new Map(existing.map((j) => [j.specKey ?? "", j]));
      const validSpecKeys = new Set(validSpecs.map((s) => s.specKey));

      for (const spec of validSpecs) {
        const match = existingBySpecKey.get(spec.specKey);
        if (match) {
          await update(match.id, {
            cronExpression: spec.cronExpression,
            channel: spec.channel,
            prompt: spec.prompt,
            timezone: spec.timezone,
            requiredTools: spec.requiredTools ?? [],
            // updateJob treats empty string as "clear" — exactly what we want when a spec
            // drops skipConditions but the persisted job still has one.
            skipConditions: spec.skipConditions ?? "",
            // updateJob treats `null` as "clear" — dropping submitResponseMode from a spec
            // clears it from the persisted job.
            submitResponseMode: spec.submitResponseMode ?? null,
            // updateJob treats an empty array as "clear" — same shape as requiredTools.
            skipDates: spec.skipDates ?? [],
            // attachedTopics: spec absent → clear the persisted field. The spec for
            // plugin-topic-instructions explicitly requires re-reconcile without the field
            // to clear it (declarative ownership), unlike `name` which is preserved on absence.
            attachedTopics: spec.attachedTopics ?? [],
            // updateJob: undefined leaves the persisted name untouched, while a non-empty
            // string overwrites it. The spec contract is "spec.name absent → leave alone",
            // so we deliberately omit the field rather than passing "".
            ...(spec.name !== undefined ? { name: spec.name } : {}),
          });
        } else {
          await create({
            cronExpression: spec.cronExpression,
            channel: spec.channel,
            prompt: spec.prompt,
            createdBy: null,
            systemActor: `plugin:${ownerKey}`,
            timezone: spec.timezone,
            plugin: ownerKey,
            pluginManaged: true,
            specKey: spec.specKey,
            ...(spec.name !== undefined ? { name: spec.name } : {}),
            ...(spec.requiredTools && spec.requiredTools.length > 0
              ? { requiredTools: spec.requiredTools }
              : {}),
            ...(spec.skipConditions ? { skipConditions: spec.skipConditions } : {}),
            ...(spec.submitResponseMode ? { submitResponseMode: spec.submitResponseMode } : {}),
            ...(spec.skipDates && spec.skipDates.length > 0 ? { skipDates: spec.skipDates } : {}),
            ...(spec.attachedTopics && spec.attachedTopics.length > 0
              ? { attachedTopics: spec.attachedTopics }
              : {}),
          });
        }
      }

      // Delete owner-jobs whose specKey isn't in the valid spec list, but DO NOT delete jobs
      // whose specKey appears in invalidSpecKeys — those were skipped, not removed.
      for (const job of existing) {
        const key = job.specKey ?? "";
        if (!validSpecKeys.has(key) && !invalidSpecKeys.has(key)) {
          await remove(job.id);
        }
      }
    },

    getSlackClient(): App["client"] | null {
      return deps.getSlackClient();
    },

    registerAction(key: string | RegExp, handler: PluginActionHandler): void {
      const fullKey = buildFullKey(key);
      actionHandlers.push({ key: fullKey, handler });
    },

    registerView(key: string | RegExp, handler: PluginViewHandler): void {
      const fullKey = buildFullKey(key);
      viewHandlers.push({ key: fullKey, handler });
    },

    actionId(key: string): string {
      if (key.startsWith("plugin:")) {
        throw new Error(
          `Plugin "${pluginName}" called actionId() with a key starting with "plugin:" ("${key}"). The SDK auto-prefixes; pass only the suffix.`,
        );
      }
      return pluginPrefix + key;
    },

    viewCallbackId(key: string): string {
      if (key.startsWith("plugin:")) {
        throw new Error(
          `Plugin "${pluginName}" called viewCallbackId() with a key starting with "plugin:" ("${key}"). The SDK auto-prefixes; pass only the suffix.`,
        );
      }
      return pluginPrefix + key;
    },

    async askClaude(opts: AskClaudeOptions): Promise<AskClaudeResult> {
      const promptParts: string[] = [];
      if (opts.system !== undefined && opts.system.length > 0) {
        promptParts.push(opts.system);
      }
      for (const m of opts.messages) {
        promptParts.push(m.content);
      }
      const prompt = promptParts.join("\n\n");

      let text = "";
      let lastAssistantText = "";
      let stopReason = "unknown";
      let inputTokens = 0;
      let outputTokens = 0;

      for await (const message of deps.clackQuery({
        prompt,
        options: {
          cwd: process.cwd(),
          executable: detectRuntime(),
          model: opts.model,
          permissionMode: "bypassPermissions",
          disallowedTools: [
            "Write",
            "Edit",
            "NotebookEdit",
            "Bash",
            "Task",
            "TaskOutput",
            "Read",
            "Glob",
            "Grep",
          ],
          maxTurns: 1,
        },
      })) {
        if (message.type === "assistant" && message.message?.content) {
          lastAssistantText = "";
          for (const block of message.message.content) {
            if ("text" in block && typeof block.text === "string") {
              lastAssistantText += block.text;
            }
          }
        }
        if (message.type === "result") {
          if (message.subtype === "success") {
            stopReason = "end_turn";
            text = (message.result || lastAssistantText).trim();
          } else {
            stopReason = message.subtype ?? "error";
            text = lastAssistantText.trim();
          }
          if (message.usage) {
            inputTokens = message.usage.input_tokens ?? 0;
            outputTokens = message.usage.output_tokens ?? 0;
          }
        }
      }

      return {
        text,
        stopReason,
        usage: { inputTokens, outputTokens },
      };
    },

    async dmOwner(
      text: string,
      options: { suppressUnfurls?: boolean } = {},
    ): Promise<{ ok: true } | { ok: false; error: string }> {
      const client = deps.getSlackClient();
      if (!client) {
        const error = "Slack client is not connected";
        logger.warn(`[plugin:${pluginName}] dmOwner failed: ${error}`);
        return { ok: false, error };
      }

      const roles = await deps.loadRoles();
      if (!roles.owner) {
        const error = "No owner is configured (set one via the Home Tab)";
        logger.warn(`[plugin:${pluginName}] dmOwner failed: ${error}`);
        return { ok: false, error };
      }

      const dmChannelId = await deps.openDmChannel(client, roles.owner);
      if (!dmChannelId) {
        const error = `Could not open a DM with the owner (${roles.owner})`;
        logger.warn(`[plugin:${pluginName}] dmOwner failed: ${error}`);
        return { ok: false, error };
      }

      try {
        await client.chat.postMessage({
          channel: dmChannelId,
          text,
          ...unfurlOptions(options.suppressUnfurls),
        });
        return { ok: true };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logger.error(`[plugin:${pluginName}] dmOwner postMessage failed: ${error}`);
        return { ok: false, error };
      }
    },
  };

  return {
    sdk,
    harvest: () => {
      // Materialize the plugin tool definitions into a heterogeneous array for the MCP server.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolDefs: SdkMcpToolDefinition<any>[] = [];
      for (const registered of tools) {
        registered.pushTo(toolDefs);
      }
      const mcpServer = createSdkMcpServer({
        name: pluginName,
        version: "1.0.0",
        tools: toolDefs,
      });
      return {
        name: pluginName,
        instructions,
        tools,
        integrations,
        toolMappings,
        mcpServer,
        watchers,
        actionHandlers,
        viewHandlers,
      };
    },
  };
}
