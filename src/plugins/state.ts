import type { LoadedPlugins } from "./registry.js";

let loadedPlugins: LoadedPlugins = { results: [] };

export function setLoadedPlugins(plugins: LoadedPlugins): void {
  loadedPlugins = plugins;
}

export function getLoadedPlugins(): LoadedPlugins {
  return loadedPlugins;
}
