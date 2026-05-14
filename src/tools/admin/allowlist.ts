import { resolve, sep } from "node:path";
import {
  existsSync as _existsSync,
  readdirSync as _readdirSync,
  readFileSync as _readFileSync,
  writeFileSync as _writeFileSync,
  mkdirSync as _mkdirSync,
} from "node:fs";
import {
  getDataDir as _getDataDir,
  validateConfig as _validateConfig,
  loadSlackAuth as _loadSlackAuth,
} from "../../config.js";

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

export interface AllowlistDeps {
  getDataDir: typeof _getDataDir;
  validateConfig: typeof _validateConfig;
  loadSlackAuth: typeof _loadSlackAuth;
  existsSync: typeof _existsSync;
  readdirSync: typeof _readdirSync;
  readFileSync: typeof _readFileSync;
  writeFileSync: typeof _writeFileSync;
  mkdirSync: typeof _mkdirSync;
}

export const defaultAllowlistDeps: AllowlistDeps = {
  getDataDir: _getDataDir,
  validateConfig: _validateConfig,
  loadSlackAuth: _loadSlackAuth,
  existsSync: _existsSync,
  readdirSync: _readdirSync,
  readFileSync: _readFileSync,
  writeFileSync: _writeFileSync,
  mkdirSync: _mkdirSync,
};

// ---------------------------------------------------------------------------
// Allowed file paths (relative to data/)
// ---------------------------------------------------------------------------

const STATIC_ALLOWED = ["config.json", "mcp.json"] as const;
const TOOL_MAPPING_GLOB = "configuration/tool_mapping/";

export function isAllowedPath(path: string): boolean {
  if (path.includes("..")) return false;
  if ((STATIC_ALLOWED as readonly string[]).includes(path)) return true;
  if (path.startsWith(TOOL_MAPPING_GLOB) && path.endsWith(".json")) return true;
  // Allow the directory itself (for listing)
  if (path === TOOL_MAPPING_GLOB) return true;
  return false;
}

export function getAllowedPaths(): string[] {
  return [...STATIC_ALLOWED, `${TOOL_MAPPING_GLOB}*.json`];
}

// ---------------------------------------------------------------------------
// Resolve to absolute path within data/
// ---------------------------------------------------------------------------

export function resolveDataPath(
  relativePath: string,
  deps: AllowlistDeps = defaultAllowlistDeps,
): string {
  const dataDir = deps.getDataDir();
  const absolute = resolve(dataDir, relativePath);
  // Safety: ensure resolved path is inside data directory
  if (!absolute.startsWith(dataDir + sep) && absolute !== dataDir) {
    throw new Error("Path traversal not allowed");
  }
  return absolute;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateContent(
  path: string,
  content: string,
  deps: AllowlistDeps = defaultAllowlistDeps,
): ValidationResult {
  if (path === "config.json") {
    return validateConfigJson(content, deps);
  }
  if (path === "mcp.json") {
    return validateMcpJson(content);
  }
  if (path.startsWith(TOOL_MAPPING_GLOB) && path.endsWith(".json")) {
    return validateJson(content);
  }
  return { valid: false, error: `No validator for path: ${path}` };
}

function validateConfigJson(content: string, deps: AllowlistDeps): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return { valid: false, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }

  try {
    const slackAuth = deps.loadSlackAuth();
    deps.validateConfig(parsed, slackAuth);
    return { valid: true };
  } catch (e) {
    return {
      valid: false,
      error: `Config validation failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

function validateMcpJson(content: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return { valid: false, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (!parsed || typeof parsed !== "object") {
    return { valid: false, error: "mcp.json must be a JSON object" };
  }

  const obj = parsed as Record<string, unknown>;
  if (!obj.mcpServers || typeof obj.mcpServers !== "object" || Array.isArray(obj.mcpServers)) {
    return { valid: false, error: "mcp.json must contain an 'mcpServers' object" };
  }

  return { valid: true };
}

function validateJson(content: string): ValidationResult {
  try {
    JSON.parse(content);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------

export function readDataFile(
  relativePath: string,
  deps: AllowlistDeps = defaultAllowlistDeps,
): {
  content: string | null;
  isDirectory: boolean;
} {
  const absolute = resolveDataPath(relativePath, deps);

  // Directory listing for tool_mapping
  if (relativePath === TOOL_MAPPING_GLOB || relativePath.endsWith("/")) {
    if (!deps.existsSync(absolute)) {
      return { content: "Directory does not exist yet.", isDirectory: true };
    }
    const files = deps
      .readdirSync(absolute)
      .filter((f) => f.endsWith(".json") && !f.startsWith("."));
    return {
      content:
        files.length === 0
          ? "No .json files found in this directory."
          : files.map((f) => `${relativePath}${f}`).join("\n"),
      isDirectory: true,
    };
  }

  if (!deps.existsSync(absolute)) {
    return { content: null, isDirectory: false };
  }

  return { content: deps.readFileSync(absolute, "utf-8") as string, isDirectory: false };
}

export function writeDataFile(
  relativePath: string,
  content: string,
  deps: AllowlistDeps = defaultAllowlistDeps,
): void {
  const absolute = resolveDataPath(relativePath, deps);

  // Create parent directories if needed
  const parentDir = resolve(absolute, "..");
  if (!deps.existsSync(parentDir)) {
    deps.mkdirSync(parentDir, { recursive: true });
  }

  deps.writeFileSync(absolute, content, "utf-8");
}

export function getFormatHint(path: string): string {
  if (path === "config.json") return "Expected format: JSON (see data/config.example.json)";
  if (path === "mcp.json") return "Expected format: JSON with { mcpServers: { ... } }";
  if (path.endsWith(".json")) return "Expected format: JSON";
  return "Unknown format";
}
