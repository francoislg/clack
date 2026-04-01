import { resolve, sep } from "node:path";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { getDataDir, validateConfig, loadSlackAuth } from "../../config.js";

// ---------------------------------------------------------------------------
// Allowed file paths (relative to data/)
// ---------------------------------------------------------------------------

const STATIC_ALLOWED = ["config.json", "mcp.json", "auth/.env"] as const;
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

export function resolveDataPath(relativePath: string): string {
  const dataDir = getDataDir();
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

export function validateContent(path: string, content: string): ValidationResult {
  if (path === "config.json") {
    return validateConfigJson(content);
  }
  if (path === "mcp.json") {
    return validateMcpJson(content);
  }
  if (path === "auth/.env") {
    return validateDotenv(content);
  }
  if (path.startsWith(TOOL_MAPPING_GLOB) && path.endsWith(".json")) {
    return validateJson(content);
  }
  return { valid: false, error: `No validator for path: ${path}` };
}

function validateConfigJson(content: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return { valid: false, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }

  try {
    const slackAuth = loadSlackAuth();
    validateConfig(parsed, slackAuth);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: `Config validation failed: ${e instanceof Error ? e.message : String(e)}` };
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

function validateDotenv(content: string): ValidationResult {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "" || line.startsWith("#")) continue;
    if (!line.includes("=")) {
      return { valid: false, error: `Line ${i + 1}: expected KEY=VALUE format, got: ${line}` };
    }
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

export function readDataFile(relativePath: string): { content: string | null; isDirectory: boolean } {
  const absolute = resolveDataPath(relativePath);

  // Directory listing for tool_mapping
  if (relativePath === TOOL_MAPPING_GLOB || relativePath.endsWith("/")) {
    if (!existsSync(absolute)) {
      return { content: "Directory does not exist yet.", isDirectory: true };
    }
    const files = readdirSync(absolute).filter((f) => f.endsWith(".json"));
    return {
      content: files.length === 0
        ? "No .json files found in this directory."
        : files.map((f) => `${relativePath}${f}`).join("\n"),
      isDirectory: true,
    };
  }

  if (!existsSync(absolute)) {
    return { content: null, isDirectory: false };
  }

  return { content: readFileSync(absolute, "utf-8"), isDirectory: false };
}

export function writeDataFile(relativePath: string, content: string): void {
  const absolute = resolveDataPath(relativePath);

  // Create parent directories if needed
  const parentDir = resolve(absolute, "..");
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  writeFileSync(absolute, content, "utf-8");
}

export function getFormatHint(path: string): string {
  if (path === "config.json") return "Expected format: JSON (see data/config.example.json)";
  if (path === "mcp.json") return "Expected format: JSON with { mcpServers: { ... } }";
  if (path === "auth/.env") return "Expected format: KEY=VALUE lines (one per line)";
  if (path.endsWith(".json")) return "Expected format: JSON";
  return "Unknown format";
}
