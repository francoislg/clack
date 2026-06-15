import { resolve, dirname, basename, extname } from "node:path";
import { createRequire } from "node:module";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../logger.js";
import { getConfig, getDataDir } from "../config.js";
import {
  createClackSdk,
  defaultClackSdkDeps,
  type ClackPlugin,
  type ClackSdkDeps,
  type PluginLoadResult,
} from "./sdk.js";
import { triviaPlugin } from "./trivia/index.js";
import { tenorGifPlugin } from "./tenor-gif/index.js";
import { giphyPlugin } from "./giphy/index.js";
import { casualTalkPlugin } from "./casual-talk/index.js";
import { commonsImageSearchPlugin } from "./commons-image-search/index.js";
import { braveImageSearchPlugin } from "./brave-image-search/index.js";
import { geminiImagePlugin } from "./gemini-image/index.js";
import { idlerPlugin } from "./idler/index.js";
import { setLoadedPlugins } from "./state.js";
import {
  registerAction as registerPluginAction,
  registerView as registerPluginView,
} from "../slack/pluginActionRegistry.js";

// ============================================================================
// Built-in Plugin Registry
// ============================================================================

const BUILTIN_PLUGINS: { [key: string]: ClackPlugin } = {
  trivia: triviaPlugin,
  "tenor-gif": tenorGifPlugin,
  giphy: giphyPlugin,
  "casual-talk": casualTalkPlugin,
  "commons-image-search": commonsImageSearchPlugin,
  "brave-image-search": braveImageSearchPlugin,
  "gemini-image": geminiImagePlugin,
  idler: idlerPlugin,
};

// ============================================================================
// External plugin loading
// ============================================================================

/**
 * Expected shape of an external plugin module's exports. The plugin function
 * may be exported as either a named `plugin` export or as the module's default.
 */
interface LocalPluginModule {
  plugin?: ClackPlugin;
  default?: ClackPlugin;
}

/**
 * A `plugins` config entry is either a built-in plugin name (e.g. `"giphy"`)
 * or a path to a local plugin module (e.g. `"data/plugins/appy-gifs/index.js"`).
 * Path entries are detected by a `/` or a JS-family extension and loaded via
 * `createRequire` — Node 22+ supports requiring synchronous ESM, so the local
 * plugin can be a plain `.js` file. The plugin's namespace name is derived from
 * the parent directory.
 */
function isPathEntry(entry: string): boolean {
  return entry.includes("/") || /\.(m|c)?js$/.test(entry);
}

function deriveLocalPluginName(absPath: string): string {
  const parent = basename(dirname(absPath));
  if (parent && parent !== "." && parent !== "plugins") return parent;
  return basename(absPath, extname(absPath));
}

const requireFromCwd = createRequire(resolve(process.cwd(), "package.json"));

function loadLocalPluginModule(entry: string): { name: string; pluginFn: ClackPlugin | undefined } {
  const absPath = resolve(process.cwd(), entry);
  const mod: LocalPluginModule = requireFromCwd(absPath);
  const name = deriveLocalPluginName(absPath);
  const candidate = mod.plugin ?? mod.default;
  return { name, pluginFn: typeof candidate === "function" ? candidate : undefined };
}

// ============================================================================
// Plugin Loading
// ============================================================================

export interface LoadedPlugins {
  results: PluginLoadResult[];
}

/**
 * Build a degraded `PluginLoadResult` for a plugin whose init threw. Exported so the
 * shape is unit-testable without driving the full plugin loader. Used by the registry's
 * catch path; admins see the resulting row in the Home Tab's `Status > Plugins` section
 * with its error banner rendered beneath.
 */
export function synthesizeErrorResult(name: string, error: unknown): PluginLoadResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    name,
    instructions: [],
    tools: [],
    mcpServers: [],
    toolMappings: new Map(),
    mcpServer: createSdkMcpServer({ name, version: "1.0.0", tools: [] }),
    watchers: [],
    actionHandlers: [],
    viewHandlers: [],
    errors: [message],
  };
}

export async function loadPlugins(
  pluginNames: string[],
  sdkDeps?: Partial<ClackSdkDeps>,
): Promise<LoadedPlugins> {
  const results: PluginLoadResult[] = [];
  const dataDir = resolve(getDataDir(), "plugins");
  // Resolve runtime capabilities once per load. Defaults to crons: true so tests that
  // never load a config still see the historical behavior; production reads `cron.enabled`
  // (default true) from the loaded config.
  let cronsEnabled = true;
  try {
    cronsEnabled = getConfig().cron?.enabled !== false;
  } catch {
    // Config not loaded — fall through with the default. Production calls loadConfig()
    // before loadPlugins() at boot, so this branch only fires in fixture/test paths.
  }
  const mergedDeps: ClackSdkDeps = {
    ...defaultClackSdkDeps,
    capabilities: { crons: cronsEnabled },
    ...sdkDeps,
  };

  for (const entry of pluginNames) {
    try {
      if (entry === "clack") {
        logger.warn(
          `Plugin name "clack" is reserved for the core MCP server — skipping plugin "${entry}"`,
        );
        continue;
      }

      let name: string;
      let pluginFn: ClackPlugin | undefined;

      if (isPathEntry(entry)) {
        const loaded = loadLocalPluginModule(entry);
        name = loaded.name;
        pluginFn = loaded.pluginFn;
        if (!pluginFn) {
          logger.warn(
            `Local plugin "${entry}" did not export a \`plugin\` (or default) function — skipping`,
          );
          continue;
        }
      } else {
        name = entry;
        pluginFn = BUILTIN_PLUGINS[entry];
        if (!pluginFn) {
          logger.warn(`Unknown plugin "${entry}" — skipping (not found in built-in registry)`);
          continue;
        }
      }

      const { sdk, harvest } = createClackSdk(name, dataDir, mergedDeps);
      await pluginFn(sdk);
      const result = harvest();
      results.push(result);
      logger.info(
        `Plugin "${name}" loaded: ${result.instructions.length} instructions, ${result.tools.length} tools`,
      );
    } catch (error) {
      logger.error(`Plugin "${entry}" failed to load — recording error:`, error);
      const errorName = isPathEntry(entry)
        ? deriveLocalPluginName(resolve(process.cwd(), entry))
        : entry;
      // Synthesize a degraded result so the failing plugin still appears in the loaded
      // set — admins see it in the Home Tab with its error banner instead of it being
      // silently dropped.
      results.push(synthesizeErrorResult(errorName, error));
    }
  }

  return { results };
}

/**
 * Install every plugin's harvested Slack action/view handlers into the central
 * dispatcher. Exposed for the lifecycle layer's reload path (which clears the
 * prior generation before re-installing). Most callers should use
 * `loadAndInstallPlugins` instead.
 */
export function installPluginInteractivity(plugins: LoadedPlugins): void {
  for (const result of plugins.results) {
    for (const entry of result.actionHandlers) {
      registerPluginAction(entry.key, entry.handler, result.name);
    }
    for (const entry of result.viewHandlers) {
      registerPluginView(entry.key, entry.handler, result.name);
    }
  }
}

/**
 * Load plugins, publish to global state, and install Slack interactivity in
 * one shot. These three steps must run together — splitting them once let a
 * cold-start path forget the install step, silently breaking every plugin
 * button click. Soft-restart callers must tear down the prior generation
 * (close watchers + `unregisterByPluginName`) before calling this.
 */
export async function loadAndInstallPlugins(
  pluginNames: string[],
  sdkDeps?: Partial<ClackSdkDeps>,
): Promise<LoadedPlugins> {
  const loaded = await loadPlugins(pluginNames, sdkDeps);
  setLoadedPlugins(loaded);
  installPluginInteractivity(loaded);
  return loaded;
}
