import { resolve } from "node:path";
import { logger } from "../logger.js";
import { getDataDir } from "../config.js";
import { createClackSdk, type ClackPlugin, type PluginLoadResult } from "./sdk.js";
import { triviaPlugin } from "./trivia/index.js";
import { gifPlugin } from "./gif/index.js";

// ============================================================================
// Built-in Plugin Registry
// ============================================================================

const BUILTIN_PLUGINS: Record<string, ClackPlugin> = {
  trivia: triviaPlugin,
  gif: gifPlugin,
};

// ============================================================================
// Plugin Loading
// ============================================================================

export interface LoadedPlugins {
  results: PluginLoadResult[];
}

export async function loadPlugins(pluginNames: string[]): Promise<LoadedPlugins> {
  const results: PluginLoadResult[] = [];
  const dataDir = resolve(getDataDir(), "plugins");

  for (const name of pluginNames) {
    try {
      if (name === "clack") {
        logger.warn(
          `Plugin name "clack" is reserved for the core MCP server — skipping plugin "${name}"`,
        );
        continue;
      }
      const pluginFn = BUILTIN_PLUGINS[name];
      if (!pluginFn) {
        logger.warn(`Unknown plugin "${name}" — skipping (not found in built-in registry)`);
        continue;
      }

      const { sdk, harvest } = createClackSdk(name, dataDir);
      await pluginFn(sdk);
      const result = harvest();
      results.push(result);
      logger.info(
        `Plugin "${name}" loaded: ${result.instructions.length} instructions, ${result.tools.length} tools`,
      );
    } catch (error) {
      logger.error(`Plugin "${name}" failed to load — skipping:`, error);
    }
  }

  return { results };
}
