import { watch, existsSync, mkdirSync, readdirSync, type FSWatcher } from "fs";
import { join, relative } from "path";
import { config as dotenvConfig } from "dotenv";
import { resetMcpCache } from "./mcp.js";
import { installAllPinnedMcpServers } from "./mcpInstaller.js";
import { resetToolMappingCache } from "./streaming/toolMappingLoader.js";
import {
  getDefaultConfigurationDir,
  getConfigurationDir,
  getDataDir,
  getConfig,
} from "./config.js";
import { clearUserSkillBodyCache } from "./userSkillsBodyCache.js";
import { logger } from "./logger.js";

const DEBOUNCE_MS = 500;

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

function watchFile(path: string, handler: () => void, label: string): FSWatcher | undefined {
  if (!existsSync(path)) return undefined;
  const watcher = watch(path, debounce(handler, DEBOUNCE_MS));
  watcher.on("error", (err) => logger.warn(`${label} watcher error:`, err));
  return watcher;
}

// fs.watch on Linux ignores { recursive: true } (Node only supports it on
// macOS/Windows), so we walk the tree at startup and watch each subdirectory
// individually. Subdirectories created at runtime aren't picked up — that's
// an acceptable trade-off given config layouts are stable.
function watchTreeRecursively(
  root: string,
  handler: (changedDir: string) => void,
  label: string,
): FSWatcher[] {
  const watchers: FSWatcher[] = [];
  if (!existsSync(root)) mkdirSync(root, { recursive: true });

  const walk = (dir: string): void => {
    const w = watch(
      dir,
      debounce(() => handler(dir), DEBOUNCE_MS),
    );
    w.on("error", (err) => logger.warn(`${label} watcher error for ${dir}:`, err));
    watchers.push(w);

    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(dir, entry.name));
      }
    } catch (err) {
      logger.warn(`${label} could not enumerate ${dir}:`, err);
    }
  };

  walk(root);
  return watchers;
}

// Re-install pinned MCP servers (`package` + `version` entries in mcp.json)
// after a cache reset. The cache holds resolved spawn configs that
// resetMcpCache just cleared, so without this they're unreachable until the
// next process boot. Fire-and-forget — watcher callbacks are sync.
function reinstallPinned(trigger: string): void {
  installAllPinnedMcpServers()
    .then(({ failed }) => {
      if (failed.length > 0) {
        logger.warn(`Pinned MCP install (${trigger}) failed for: ${failed.join(", ")}`);
      }
    })
    .catch((error) => {
      logger.warn(
        `Pinned MCP install (${trigger}) threw: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
}

export interface ConfigWatcherOptions {
  /**
   * Called (debounced) when `data/config.json` changes on disk. When provided, the watcher
   * piggybacks on the existing config-watcher infrastructure to trigger a full lifecycle
   * reload — the only safe way to surface config changes to every cache and scheduler
   * without duplicating the reset logic. Omit to disable config-file watching (e.g. in tests
   * where the lifecycle module isn't wired up).
   */
  onConfigJsonChange?: () => void;
}

/**
 * Watch config files for changes and invalidate caches.
 * Returns a stop function that closes all watchers.
 */
export function startConfigWatcher(opts: ConfigWatcherOptions = {}): () => void {
  const mcpPath = join(process.cwd(), "data", "mcp.json");
  const envPath = join(process.cwd(), "data", "auth", ".env");
  const configJsonPath = join(process.cwd(), "data", "config.json");
  const defaultConfigDir = getDefaultConfigurationDir();
  const userConfigDir = getConfigurationDir();

  const watchers: FSWatcher[] = [];
  const watched: string[] = [];

  const mcpWatcher = watchFile(
    mcpPath,
    () => {
      logger.info("MCP config changed (data/mcp.json) — cache invalidated");
      resetMcpCache();
      resetToolMappingCache();
      reinstallPinned("mcp.json change");
    },
    "MCP config",
  );
  if (mcpWatcher) {
    watchers.push(mcpWatcher);
    watched.push("mcp.json");
  }

  if (opts.onConfigJsonChange) {
    const configJsonWatcher = watchFile(
      configJsonPath,
      () => {
        logger.info("Config file changed (data/config.json) — triggering full reload");
        opts.onConfigJsonChange?.();
      },
      "config.json",
    );
    if (configJsonWatcher) {
      watchers.push(configJsonWatcher);
      watched.push("config.json");
    }
  }

  const envWatcher = watchFile(
    envPath,
    () => {
      logger.info(
        "Environment file changed (data/auth/.env) — reloading env vars and invalidating MCP cache",
      );
      dotenvConfig({ path: envPath, override: true });
      resetMcpCache();
      resetToolMappingCache();
      reinstallPinned(".env change");
    },
    "Env file",
  );
  if (envWatcher) {
    watchers.push(envWatcher);
    watched.push(".env");
  }

  // Watch the full default_configuration/ and configuration/ trees. Tool-mapping
  // is the only cache currently invalidated here; instruction templates (role
  // baselines, topics, etc.) are read fresh per-session, so this is largely an
  // observability hook for them — future caches can plug into the same handler.
  const onConfigurationChange = (changedDir: string) => {
    const rel = relative(process.cwd(), changedDir) || changedDir;
    logger.info(`Configuration changed under ${rel} — caches invalidated`);
    resetToolMappingCache();
  };

  watchers.push(...watchTreeRecursively(defaultConfigDir, onConfigurationChange, "Default config"));
  watched.push("default_configuration/");
  watchers.push(...watchTreeRecursively(userConfigDir, onConfigurationChange, "User config"));
  watched.push("configuration/");

  // User-created skills — watch the tree so external edits to SKILL.md or .meta.json
  // bust the body cache promptly. Correctness still relies on the mtime check inside
  // `getUserSkillBody`; the watcher is a freshness optimization. Gated on the feature
  // flag so we don't keep watchers open in installations that don't use the feature.
  let userSkillsEnabled = false;
  try {
    userSkillsEnabled = getConfig().userSkills?.enabled === true;
  } catch {
    // Config not loaded yet — watcher won't activate this generation. A subsequent
    // lifecycle reload (triggered by config.json change) will rerun this code with
    // config loaded.
  }
  if (userSkillsEnabled) {
    const userSkillsDir = join(getDataDir(), "user-skills");
    const onUserSkillsChange = (changedDir: string) => {
      const rel = relative(process.cwd(), changedDir) || changedDir;
      logger.info(`User-skills directory changed (${rel}) — body cache invalidated`);
      clearUserSkillBodyCache();
    };
    watchers.push(...watchTreeRecursively(userSkillsDir, onUserSkillsChange, "User skills"));
    watched.push("user-skills/");
  }

  logger.info(`Watching for config changes: ${watched.join(", ")}`);

  return function stop() {
    for (const watcher of watchers) watcher.close();
    watchers.length = 0;
  };
}
