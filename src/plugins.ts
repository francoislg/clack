import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import type { SdkPluginConfig } from "@anthropic-ai/claude-agent-sdk";
import { getDataDir } from "./config.js";

// ============================================================================
// Dependency Injection
// ============================================================================

export interface PluginsDeps {
  existsSync: typeof existsSync;
  readdirSync: typeof readdirSync;
  readFileSync: typeof readFileSync;
  statSync: typeof statSync;
  getDataDir: typeof getDataDir;
}

export const defaultPluginsDeps: PluginsDeps = {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  getDataDir,
};

let deps: PluginsDeps = defaultPluginsDeps;

export function setPluginsDeps(d: PluginsDeps): void {
  deps = d;
}

export function resetPluginsDeps(): void {
  deps = defaultPluginsDeps;
}

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
  const pluginsDir = resolve(deps.getDataDir(), "plugins");

  if (!deps.existsSync(pluginsDir)) {
    return [];
  }

  const entries = deps.readdirSync(pluginsDir);
  const plugins: PluginInfo[] = [];

  for (const entry of entries) {
    const entryPath = join(pluginsDir, entry);
    if (!deps.statSync(entryPath).isDirectory()) continue;

    const pluginDir = join(entryPath, ".claude-plugin");
    const manifestPath = deps.existsSync(join(pluginDir, "plugin.json"))
      ? join(pluginDir, "plugin.json")
      : deps.existsSync(join(pluginDir, "marketplace.json"))
        ? join(pluginDir, "marketplace.json")
        : null;
    if (!manifestPath) continue;

    let name = basename(entryPath);
    let skillCount = 0;

    try {
      const manifest = JSON.parse(deps.readFileSync(manifestPath, "utf-8"));
      name = manifest.name ?? name;
      // Count skills from manifest or from skills/ directory
      if (manifest.plugins?.[0]?.skills) {
        skillCount = manifest.plugins[0].skills.length;
      } else {
        const skillsDir = join(entryPath, "skills");
        if (deps.existsSync(skillsDir)) {
          skillCount = deps
            .readdirSync(skillsDir)
            .filter((s) => deps.statSync(join(skillsDir, s)).isDirectory()).length;
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
