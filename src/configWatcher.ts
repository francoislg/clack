import { watch, existsSync, mkdirSync, type FSWatcher } from "fs";
import { join } from "path";
import { config as dotenvConfig } from "dotenv";
import { resetMcpCache } from "./mcp.js";
import { resetToolMappingCache } from "./streaming/toolMappingLoader.js";
import { getDefaultConfigurationDir, getConfigurationDir } from "./config.js";
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

function watchDir(dir: string, handler: () => void, label: string): FSWatcher {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const watcher = watch(dir, debounce(handler, DEBOUNCE_MS));
  watcher.on("error", (err) => logger.warn(`${label} watcher error:`, err));
  return watcher;
}

/**
 * Watch config files for changes and invalidate caches.
 * Returns a stop function that closes all watchers.
 */
export function startConfigWatcher(): () => void {
  const mcpPath = join(process.cwd(), "data", "mcp.json");
  const envPath = join(process.cwd(), "data", "auth", ".env");
  const defaultToolMappingDir = join(getDefaultConfigurationDir(), "tool_mapping");
  const userToolMappingDir = join(getConfigurationDir(), "tool_mapping");

  const watchers: FSWatcher[] = [];
  const watched: string[] = [];

  const mcpWatcher = watchFile(
    mcpPath,
    () => {
      logger.info("MCP config changed (data/mcp.json) — cache invalidated");
      resetMcpCache();
      resetToolMappingCache();
    },
    "MCP config",
  );
  if (mcpWatcher) {
    watchers.push(mcpWatcher);
    watched.push("mcp.json");
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
    },
    "Env file",
  );
  if (envWatcher) {
    watchers.push(envWatcher);
    watched.push(".env");
  }

  const onToolMappingChange = () => {
    logger.info("Tool mapping config changed — cache invalidated");
    resetToolMappingCache();
  };
  watchers.push(watchDir(defaultToolMappingDir, onToolMappingChange, "Default tool mapping"));
  watched.push("default tool_mapping/");
  watchers.push(watchDir(userToolMappingDir, onToolMappingChange, "User tool mapping"));
  watched.push("user tool_mapping/");

  logger.info(`Watching for config changes: ${watched.join(", ")}`);

  return function stop() {
    for (const watcher of watchers) watcher.close();
    watchers.length = 0;
  };
}
