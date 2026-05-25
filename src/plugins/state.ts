import type { LoadedPlugins } from "./registry.js";
import type { PluginIntegration } from "./sdk.js";

let loadedPlugins: LoadedPlugins = { results: [] };

export function setLoadedPlugins(plugins: LoadedPlugins): void {
  loadedPlugins = plugins;
}

export function getLoadedPlugins(): LoadedPlugins {
  return loadedPlugins;
}

export function getLoadedPluginIntegrations(): Array<PluginIntegration & { pluginName: string }> {
  return loadedPlugins.results.flatMap((p) =>
    p.integrations.map((i) => ({ ...i, pluginName: p.name })),
  );
}
