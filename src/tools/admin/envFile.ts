import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

const ENV_PATH = join(process.cwd(), "data", "auth", ".env");
const KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SetEnvResult {
  key: string;
  action: "added" | "updated" | "deleted" | "not_found";
  error?: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function isValidEnvKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------

export function setEnvVar(key: string, value?: string): SetEnvResult {
  const isDelete = !value || value === "";
  const lines = loadEnvLines();

  const existingIndex = lines.findIndex((l) => {
    const trimmed = l.trim();
    return !trimmed.startsWith("#") && trimmed.startsWith(`${key}=`);
  });

  if (isDelete) {
    if (existingIndex === -1) {
      return { key, action: "not_found" };
    }
    lines.splice(existingIndex, 1);
    writeEnvLines(lines);
    return { key, action: "deleted" };
  }

  if (existingIndex !== -1) {
    lines[existingIndex] = `${key}=${value}`;
    writeEnvLines(lines);
    return { key, action: "updated" };
  }

  lines.push(`${key}=${value}`);
  writeEnvLines(lines);
  return { key, action: "added" };
}

export function listEnvKeys(): string[] {
  if (!existsSync(ENV_PATH)) return [];
  return readFileSync(ENV_PATH, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#") && l.includes("="))
    .map((l) => l.split("=")[0]);
}

// ---------------------------------------------------------------------------
// File I/O (internal)
// ---------------------------------------------------------------------------

function loadEnvLines(): string[] {
  if (!existsSync(ENV_PATH)) return [];
  return readFileSync(ENV_PATH, "utf-8").split("\n");
}

function writeEnvLines(lines: string[]): void {
  const parentDir = join(ENV_PATH, "..");
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }
  const content = lines.filter((l, i) => i < lines.length - 1 || l.trim() !== "").join("\n") + "\n";
  writeFileSync(ENV_PATH, content, "utf-8");
}
