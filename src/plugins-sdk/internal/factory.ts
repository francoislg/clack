// Implementation half of the plugin SDK — bridge file (imports bot core).
// Kept OUT of `sdk.ts` so that plugins can value-import the `sdk.js` façade
// without evaluating the core module graph (sdk → cronScheduler → handlers/core
// → tools/server → lifecycle → registry → plugin — the cycle documented on
// `ClackSdkDeps.executeCronJob`). Core (registry/lifecycle) imports the factory
// from here; plugins never do — plugin tests get `createClackSdk` via
// `plugins-sdk/testHelpers.js`.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, mkdirSync, watch as fsWatch, type FSWatcher } from "node:fs";
import { join, normalize, isAbsolute } from "node:path";
import {
  createSdkMcpServer,
  type SdkMcpToolDefinition,
  type AnyZodRawShape,
} from "@anthropic-ai/claude-agent-sdk";
import { loadRoles, type UserRole } from "../../roles.js";
import { createUsersSurface } from "./users.js";
import { createMemorySurface } from "./memory.js";
import { createCronSurface } from "./cron.js";
import { createMessagingSurface } from "./messaging.js";
import type { RoleDir } from "../../cascadingConfigResolver.js";
import { openDmChannel } from "../../slack/channelResolver.js";
import { logger } from "../../logger.js";
import { getSlackClient as defaultGetSlackClient } from "../../slack/app.js";
import type { PluginActionHandler, PluginViewHandler } from "../../slack/pluginActionRegistry.js";
import { findByPluginOwner, createJob, updateJob, deleteJob } from "../../cronJobs.js";
import { registerDelayedBootHandler, computeMissedRuns } from "../../cronCatchUp.js";
import { registerThreadSession } from "../../sessions.js";
import { clackQuery as defaultClackQuery } from "../../claude/query.js";
import { getConfig } from "../../config.js";
import type { Lang } from "../../i18n/languages.js";
import type { App } from "@slack/bolt";
import type {
  ClackSdk,
  ClackSdkCapabilities,
  ClackSdkDeps,
  PluginDictionary,
  PluginLoadResult,
  PluginLogger,
  PluginMcpServerSpec,
  PluginVars,
  RegisteredActionEntry,
  RegisteredInstruction,
  RegisteredMcpServer,
  RegisteredTool,
  RegisteredViewEntry,
  ToolMapping,
} from "../sdk.js";

function validateRelativePath(path: string): void {
  if (isAbsolute(path)) {
    throw new Error(`Absolute paths are not allowed: ${path}`);
  }
  const normalized = normalize(path);
  if (normalized.startsWith("..")) {
    throw new Error(`Path traversal is not allowed: ${path}`);
  }
}

export const defaultClackSdkDeps: ClackSdkDeps = {
  getSlackClient: defaultGetSlackClient,
  loadRoles,
  openDmChannel,
  registerThreadSession,
  findByPluginOwner,
  createJob,
  updateJob,
  deleteJob,
  registerDelayedBootHandler,
  computeMissedRuns,
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
  const mcpServers: PluginMcpServerSpec[] = [];
  const toolMappings = new Map<string, ToolMapping>();
  const watchers: FSWatcher[] = [];
  const actionHandlers: RegisteredActionEntry[] = [];
  const viewHandlers: RegisteredViewEntry[] = [];
  const errors: string[] = [];
  const capabilities: ClackSdkCapabilities = deps.capabilities ?? { crons: true };
  const pluginDataDir = join(dataDir, pluginName);
  const pluginPrefix = `plugin:${pluginName}:`;

  function createMcpServerHandle(
    serverKey: string | undefined,
    fullName: string,
  ): RegisteredMcpServer {
    return {
      fullName,
      registerTool<T extends AnyZodRawShape>(
        minRole: UserRole,
        toolDef: SdkMcpToolDefinition<T>,
        mapping: ToolMapping,
      ): void {
        tools.push({
          name: toolDef.name,
          minRole,
          serverKey,
          pushTo: (target) => target.push(toolDef as SdkMcpToolDefinition<AnyZodRawShape>),
        });
        toolMappings.set(toolDef.name, mapping);
      },
      addTopicInstruction(role: RoleDir, filename: string, content: string): void {
        const key = `topics/${fullName}/${pluginName}__${filename}.md`;
        instructions.push({ role, filename: key, content });
      },
    };
  }

  const defaultMcpServer: RegisteredMcpServer = createMcpServerHandle(undefined, pluginName);

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
    debug: (...args) => logger.debug(pluginLogPrefix, ...args),
    info: (...args) => logger.info(pluginLogPrefix, ...args),
    warn: (...args) => logger.warn(pluginLogPrefix, ...args),
    error: (...args) => logger.error(pluginLogPrefix, ...args),
  };

  let dictionary: PluginDictionary | null = null;
  const fallbackWarned = new Set<string>();

  function activeLanguage(): Lang {
    try {
      return getConfig().language ?? "en";
    } catch {
      return "en";
    }
  }

  function interpolate(template: string, vars: PluginVars): string {
    let out = template;
    for (const [name, value] of Object.entries(vars)) {
      out = out.replaceAll(`{${name}}`, String(value));
    }
    return out;
  }

  const sdk: ClackSdk = {
    ...createCronSurface(pluginName, deps),
    ...createMessagingSurface(pluginName, pluginLogger, deps),

    logger: pluginLogger,
    capabilities,
    mcpServer: defaultMcpServer,
    registerMcpServer(
      name: string,
      options: { autoload?: boolean; description: string },
    ): RegisteredMcpServer {
      if (typeof name !== "string" || name.length === 0) {
        throw new Error(`registerMcpServer requires a non-empty name (plugin: ${pluginName})`);
      }
      if (name.includes(":")) {
        throw new Error(
          `registerMcpServer name must not contain ':' (got "${name}" in plugin "${pluginName}"). The SDK auto-prefixes the plugin name to produce "<plugin>:<name>".`,
        );
      }
      const fullName = `${pluginName}:${name}`;
      if (mcpServers.some((s) => s.key === name)) {
        throw new Error(
          `registerMcpServer("${name}") called twice in plugin "${pluginName}" — names must be unique within a plugin.`,
        );
      }
      mcpServers.push({
        key: name,
        fullName,
        autoload: options.autoload ?? false,
        description: options.description,
      });
      return createMcpServerHandle(name, fullName);
    },
    error(reason: string): void {
      errors.push(reason);
      logger.warn(pluginLogPrefix, "sdk.error:", reason);
    },
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
    ): void {
      defaultMcpServer.registerTool(minRole, toolDef, mapping);
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

    async readFileOrSeed(path: string, defaultContent: string): Promise<string> {
      const existing = await this.readFile(path);
      if (existing !== null) return existing;
      try {
        await this.writeFile(path, defaultContent);
      } catch (err) {
        pluginLogger.warn(
          `could not seed "${path}" (running on defaults): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return defaultContent;
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

    getSlackClient(): App["client"] | null {
      return deps.getSlackClient();
    },

    users: createUsersSurface(deps, pluginName, (message) => logger.warn(message)),

    memory: createMemorySurface({}, pluginName, (message) => logger.warn(message)),

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

    requestSoftRestart(reason: string): void {
      const fn = deps.requestSoftRestart;
      if (!fn) {
        pluginLogger.warn(
          `requestSoftRestart("${reason}") called but no handler was wired into ClackSdkDeps — ignoring`,
        );
        return;
      }
      fn(`[plugin:${pluginName}] ${reason}`);
    },

    registerDictionary(dictionaries: PluginDictionary): void {
      if (
        dictionaries === null ||
        typeof dictionaries !== "object" ||
        typeof dictionaries.en !== "object" ||
        dictionaries.en === null
      ) {
        throw new Error(
          `registerDictionary requires an object with an \`en\` table (plugin: ${pluginName})`,
        );
      }
      dictionary = dictionaries;
      fallbackWarned.clear();
    },

    t(key: string, vars?: PluginVars): string {
      if (dictionary === null) {
        throw new Error(
          `Plugin "${pluginName}" called sdk.t("${key}") before sdk.registerDictionary(...) — register your dictionary at plugin init.`,
        );
      }
      if (!(key in dictionary.en)) {
        throw new Error(`Plugin "${pluginName}": missing translation key "${key}" in \`en\` table`);
      }
      const lang = activeLanguage();
      let template = dictionary.en[key];
      if (lang !== "en") {
        const table = dictionary[lang];
        const value = table?.[key];
        if (value !== undefined && value !== "") {
          template = value;
        } else if (!fallbackWarned.has(key)) {
          fallbackWarned.add(key);
          pluginLogger.warn(
            `i18n: missing translation for key "${key}" in language "${lang}" — falling back to "en"`,
          );
        }
      }
      if (!vars) return template;
      return interpolate(template, vars);
    },
  };

  return {
    sdk,
    harvest: () => {
      // Materialize the plugin tool definitions into a heterogeneous array for the MCP server.
      const toolDefs: SdkMcpToolDefinition<AnyZodRawShape>[] = [];
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
        mcpServers,
        toolMappings,
        mcpServer,
        watchers,
        actionHandlers,
        viewHandlers,
        errors,
      };
    },
  };
}
