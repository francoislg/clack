import { resolve, dirname, basename, extname } from "node:path";
import { createRequire } from "node:module";
import { logger } from "../logger.js";
import { getDataDir } from "../config.js";
import { createClackSdk, type ClackPlugin, type PluginLoadResult } from "./sdk.js";
import { triviaPlugin } from "./trivia/index.js";
import { tenorGifPlugin } from "./tenor-gif/index.js";
import { giphyPlugin } from "./giphy/index.js";

// ============================================================================
// Built-in Plugin Registry
// ============================================================================

const BUILTIN_PLUGINS: { [key: string]: ClackPlugin } = {
  trivia: triviaPlugin,
  "tenor-gif": tenorGifPlugin,
  giphy: giphyPlugin,
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

export async function loadPlugins(pluginNames: string[]): Promise<LoadedPlugins> {
  const results: PluginLoadResult[] = [];
  const dataDir = resolve(getDataDir(), "plugins");

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

      const { sdk, harvest } = createClackSdk(name, dataDir);
      await pluginFn(sdk);
      const result = harvest();
      results.push(result);
      logger.info(
        `Plugin "${name}" loaded: ${result.instructions.length} instructions, ${result.tools.length} tools`,
      );
    } catch (error) {
      logger.error(`Plugin "${entry}" failed to load — skipping:`, error);
    }
  }

  return { results };
}
