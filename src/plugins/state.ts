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

/** Names of plugin-registered tools gated on the given integration (full MCP names). */
export function getToolsGatedByIntegration(integrationName: string): string[] {
  const names: string[] = [];
  for (const plugin of loadedPlugins.results) {
    for (const t of plugin.tools) {
      if (t.integration === integrationName) {
        names.push(`mcp__${plugin.name}__${t.name}`);
      }
    }
  }
  return names;
}
