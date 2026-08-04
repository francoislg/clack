import type { LoadedPlugins } from "./registry.js";
import type { RegisteredPreferences } from "../plugins-sdk/sdk.js";

let loadedPlugins: LoadedPlugins = { results: [] };

export function setLoadedPlugins(plugins: LoadedPlugins): void {
  loadedPlugins = plugins;
}

export function getLoadedPlugins(): LoadedPlugins {
  return loadedPlugins;
}

/**
 * Flatten every loaded plugin's on-demand MCP server declarations into the shape
 * expected by `resolveEffectiveRegistry`. Each entry becomes a catalog entry in
 * the merged registry so `attach_integration(fullName)` validates.
 */
export function getLoadedPluginIntegrations(): Array<{
  name: string;
  description: string;
  alwaysLoad: boolean;
  pluginName: string;
}> {
  return loadedPlugins.results.flatMap((p) =>
    p.mcpServers.map((s) => ({
      name: s.fullName,
      description: s.description,
      alwaysLoad: s.autoload,
      pluginName: p.name,
    })),
  );
}

export function getLoadedPluginPreferences(): Array<{
  plugin: string;
  preferences: RegisteredPreferences;
}> {
  return loadedPlugins.results
    .filter((p) => p.preferences !== undefined)
    .map((p) => ({ plugin: p.name, preferences: p.preferences as RegisteredPreferences }));
}
