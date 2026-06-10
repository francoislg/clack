import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { z } from "zod";
import type { SdkPluginConfig } from "@anthropic-ai/claude-agent-sdk";
import { getConfig, getDataDir } from "./config.js";
import type { SkillPluginRegistry } from "./config.js";

// Only the two fields discovery reads; everything optional so a real manifest never
// fails validation (a JSON/parse failure still falls through to basename defaults).
const skillPluginManifestZod = z.object({
  name: z.string().optional(),
  plugins: z.array(z.object({ skills: z.array(z.unknown()).optional() })).optional(),
});

// ============================================================================
// Dependency Injection
// ============================================================================

/**
 * Dependencies used by plugin discovery. Narrow function signatures (vs. Node's
 * overload-rich types) so tests can supply plain `mock.fn` values without casts.
 * The real Node imports are assignable to these narrower shapes via overload
 * resolution.
 */
export interface SkillPluginsDeps {
  existsSync: (path: string) => boolean;
  readdirSync: (path: string) => string[];
  readFileSync: (path: string, encoding: "utf-8" | "utf8") => string;
  statSync: (path: string) => { isDirectory: () => boolean };
  getDataDir: () => string;
  /** Only the `skillPlugins` field is read; the interface is deliberately narrow. */
  getConfig: () => { skillPlugins?: SkillPluginRegistry };
}

export const defaultSkillPluginsDeps: SkillPluginsDeps = {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  getDataDir,
  getConfig,
};

let deps: SkillPluginsDeps = defaultSkillPluginsDeps;

export function setSkillPluginsDeps(d: SkillPluginsDeps): void {
  deps = d;
}

export function resetSkillPluginsDeps(): void {
  deps = defaultSkillPluginsDeps;
}

export interface SkillPluginInfo {
  name: string;
  path: string;
  skillCount: number;
  /**
   * True when the plugin has `config.skillPlugins[name].lazyLoad === true`.
   * Lazy plugins are excluded from the SDK session-start plugin set; their skills
   * are discovered via `list_skill_pack_skills` and loaded via `load_skill`.
   */
  lazyLoad: boolean;
}

/**
 * Safely read `config.skillPlugins` without throwing if config isn't loaded yet.
 * Callers in test paths may run without calling `loadConfig` first — for robustness,
 * treat any error (including "Config not loaded") as "no registry, eager by default".
 */
function safeSkillPluginsRegistry(): Record<string, { lazyLoad: boolean }> | undefined {
  try {
    return deps.getConfig().skillPlugins;
  } catch {
    return undefined;
  }
}

/**
 * Scan data/skill-plugins/ for valid SDK skill pack directories.
 * Returns rich metadata for display and SDK configs.
 */
export function discoverSkillPluginInfo(): SkillPluginInfo[] {
  const pluginsDir = resolve(deps.getDataDir(), "skill-plugins");

  if (!deps.existsSync(pluginsDir)) {
    return [];
  }

  const entries = deps.readdirSync(pluginsDir);
  const plugins: SkillPluginInfo[] = [];

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
      const manifest = skillPluginManifestZod.parse(
        JSON.parse(deps.readFileSync(manifestPath, "utf-8")),
      );
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

    const registry = safeSkillPluginsRegistry();
    const lazyLoad = registry?.[name]?.lazyLoad === true;
    plugins.push({ name, path: entryPath, skillCount, lazyLoad });
  }

  return plugins;
}

/** Returns SDK-compatible plugin configs for use in query() options. */
export function discoverSkillPlugins(): SdkPluginConfig[] {
  return discoverSkillPluginInfo().map((p) => ({ type: "local", path: p.path }));
}

/**
 * Like `discoverSkillPlugins()`, but omits any plugin tagged `lazyLoad: true` in the
 * `skillPlugins` registry. Lazy plugins' skill frontmatter never enters the SDK
 * session-start plugin set — their skills are loaded on demand via `load_skill`.
 * Use this in `buildQuerySetup` when wiring `options.plugins` for `query()`.
 */
export function discoverEagerSkillPlugins(): SdkPluginConfig[] {
  return discoverSkillPluginInfo()
    .filter((p) => !p.lazyLoad)
    .map((p) => ({ type: "local", path: p.path }));
}
