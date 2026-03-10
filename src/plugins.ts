import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import type { SdkPluginConfig } from "@anthropic-ai/claude-agent-sdk";
import { getDataDir } from "./config.js";

export interface PluginInfo {
  name: string;
  path: string;
  skillCount: number;
}

/**
 * Scan data/plugins/ for valid plugin directories.
 * Returns rich metadata for display and SDK configs.
 */
export function discoverPluginInfo(): PluginInfo[] {
  const pluginsDir = resolve(getDataDir(), "plugins");

  if (!existsSync(pluginsDir)) {
    return [];
  }

  const entries = readdirSync(pluginsDir);
  const plugins: PluginInfo[] = [];

  for (const entry of entries) {
    const entryPath = join(pluginsDir, entry);
    if (!statSync(entryPath).isDirectory()) continue;

    const pluginDir = join(entryPath, ".claude-plugin");
    const manifestPath = existsSync(join(pluginDir, "plugin.json"))
      ? join(pluginDir, "plugin.json")
      : existsSync(join(pluginDir, "marketplace.json"))
        ? join(pluginDir, "marketplace.json")
        : null;
    if (!manifestPath) continue;

    let name = basename(entryPath);
    let skillCount = 0;

    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      name = manifest.name ?? name;
      // Count skills from manifest or from skills/ directory
      if (manifest.plugins?.[0]?.skills) {
        skillCount = manifest.plugins[0].skills.length;
      } else {
        const skillsDir = join(entryPath, "skills");
        if (existsSync(skillsDir)) {
          skillCount = readdirSync(skillsDir).filter(
            (s) => statSync(join(skillsDir, s)).isDirectory()
          ).length;
        }
      }
    } catch {
      // Use defaults on parse failure
    }

    plugins.push({ name, path: entryPath, skillCount });
  }

  return plugins;
}

/** Returns SDK-compatible plugin configs for use in query() options. */
export function discoverPlugins(): SdkPluginConfig[] {
  return discoverPluginInfo().map((p) => ({ type: "local", path: p.path }));
}
