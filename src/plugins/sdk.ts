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
import { getSlackClient as defaultGetSlackClient } from "../slack/app.js";
import { logger } from "../logger.js";
import { findByPluginOwner, createJob, updateJob, deleteJob, type SkipDate } from "../cronJobs.js";

// ============================================================================
// Types
// ============================================================================

/** Tool mapping entry — same format as tool_mapping JSON config entries. */
export type ToolMapping = string | ToolEntryObject;

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
  requiredTools?: string[];
  skipConditions?: string;
  /**
   * Structured calendar-date skip list. Propagated as-is into the resulting `CronJob.skipDates`.
   * Omit (or pass an empty array) to leave the job's `skipDates` unset.
   */
  skipDates?: SkipDate[];
}

export interface ClackSdk {
  addInstruction(role: RoleDir, filename: string, content: string): void;
  /**
   * Register an MCP tool with a minimum role requirement and a Slack task card mapping.
   * @param mapping — Display label for Slack task cards. Either a template string with `{argName}` interpolation,
   *   or an object with `label`, optional `group`, and optional `itemDetail`.
   */
  registerTool<T extends AnyZodRawShape>(
    minRole: UserRole,
    tool: SdkMcpToolDefinition<T>,
    mapping: ToolMapping,
  ): void;
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
   */
  dmOwner(text: string): Promise<{ ok: true } | { ok: false; error: string }>;
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
  pushTo: (target: SdkMcpToolDefinition<AnyZodRawShape>[]) => void;
}

export interface PluginLoadResult {
  name: string;
  instructions: RegisteredInstruction[];
  tools: RegisteredTool[];
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
}

export const defaultClackSdkDeps: ClackSdkDeps = {
  getSlackClient: defaultGetSlackClient,
  loadRoles,
  openDmChannel,
  findByPluginOwner,
  createJob,
  updateJob,
  deleteJob,
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
  const toolMappings = new Map<string, ToolMapping>();
  const watchers: FSWatcher[] = [];
  const pluginDataDir = join(dataDir, pluginName);

  const sdk: ClackSdk = {
    addInstruction(role: RoleDir, filename: string, content: string): void {
      const prefixedFilename = `${pluginName}__${filename}.md`;
      instructions.push({ role, filename: prefixedFilename, content });
    },

    registerTool<T extends AnyZodRawShape>(
      minRole: UserRole,
      toolDef: SdkMcpToolDefinition<T>,
      mapping: ToolMapping,
    ): void {
      tools.push({
        name: toolDef.name,
        minRole,
        // Capture the tool in a closure that pushes it to the target array.
        // This avoids storing it with an incompatible generic type.
        pushTo: (target) => target.push(toolDef as SdkMcpToolDefinition<AnyZodRawShape>),
      });
      toolMappings.set(toolDef.name, mapping);
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
            // updateJob treats an empty array as "clear" — same shape as requiredTools.
            skipDates: spec.skipDates ?? [],
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
            ...(spec.requiredTools && spec.requiredTools.length > 0
              ? { requiredTools: spec.requiredTools }
              : {}),
            ...(spec.skipConditions ? { skipConditions: spec.skipConditions } : {}),
            ...(spec.skipDates && spec.skipDates.length > 0 ? { skipDates: spec.skipDates } : {}),
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

    async dmOwner(text: string): Promise<{ ok: true } | { ok: false; error: string }> {
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
        await client.chat.postMessage({ channel: dmChannelId, text });
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
        toolMappings,
        mcpServer,
        watchers,
      };
    },
  };
}
