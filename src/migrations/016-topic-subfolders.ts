import type { Migration, StaticFileResult } from "./types.js";

/**
 * Seed `config.mcpServers` from `data/mcp.json` keys so operators have a starting
 * point for the lazy-loading registry. Each mcp.json server without an explicit
 * registry entry gets a `{ alwaysLoad: false, description: TODO }` stub. Operator-
 * set entries are preserved verbatim.
 *
 * This migration does NOT touch instruction files — the content-aware split between
 * baseline "when to use X" triggers and topic-scoped "how to use X" specifics is
 * handled by the Claude-powered migration 017.
 */

const CONFIG_PATH = "data/config.json";
const MCP_PATH = "data/mcp.json";

const TODO_DESCRIPTION = "TODO: describe this integration so Claude knows when to use it";

type JsonPrimitive = string | number | boolean | null;
type JsonArray = JsonValue[];
interface JsonObject {
  [key: string]: JsonValue;
}
type JsonValue = JsonPrimitive | JsonArray | JsonObject;

interface RegistryEntry {
  alwaysLoad: boolean;
  description: string;
}

type Registry = { [name: string]: RegistryEntry };

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeJsonParse(text: string): JsonValue | undefined {
  try {
    const parsed: JsonValue = JSON.parse(text);
    return parsed;
  } catch {
    return undefined;
  }
}

function parseMcpServerNames(mcpJson: string | null): string[] {
  if (!mcpJson) return [];
  const parsed = safeJsonParse(mcpJson);
  if (!isJsonObject(parsed)) return [];
  const servers = parsed.mcpServers;
  if (!isJsonObject(servers)) return [];
  return Object.keys(servers);
}

function cloneValidRegistry(source: JsonValue | undefined): Registry {
  const result: Registry = {};
  if (!isJsonObject(source)) return result;
  for (const [name, entry] of Object.entries(source)) {
    if (
      isJsonObject(entry) &&
      typeof entry.alwaysLoad === "boolean" &&
      typeof entry.description === "string"
    ) {
      result[name] = { alwaysLoad: entry.alwaysLoad, description: entry.description };
    }
  }
  return result;
}

function registriesEqual(a: Registry, b: Registry): boolean {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    if (aKeys[i] !== bKeys[i]) return false;
    const ka = a[aKeys[i]];
    const kb = b[bKeys[i]];
    if (ka.alwaysLoad !== kb.alwaysLoad || ka.description !== kb.description) return false;
  }
  return true;
}

function registryToJson(registry: Registry): JsonObject {
  const out: JsonObject = {};
  for (const [name, entry] of Object.entries(registry)) {
    out[name] = { alwaysLoad: entry.alwaysLoad, description: entry.description };
  }
  return out;
}

function seedRegistry(
  config: JsonObject,
  mcpServerNames: string[],
): { changed: boolean; seeded: string[] } {
  const existing = cloneValidRegistry(config.mcpServers);
  const next: Registry = { ...existing };
  const seeded: string[] = [];

  for (const name of mcpServerNames) {
    if (!(name in next)) {
      next[name] = { alwaysLoad: false, description: TODO_DESCRIPTION };
      seeded.push(name);
    }
  }

  const changed = !registriesEqual(existing, next);
  if (changed) {
    config.mcpServers = registryToJson(next);
  }
  return { changed, seeded };
}

export const migration: Migration = {
  version: 16,
  name: "Seed config.mcpServers from data/mcp.json keys",
  priority: "blocking",
  files: [CONFIG_PATH, MCP_PATH],
  static: (files) => {
    const result: { [path: string]: StaticFileResult } = {};

    const configText = files[CONFIG_PATH];
    if (!configText) return result;

    const parsed = safeJsonParse(configText);
    if (!isJsonObject(parsed)) return result;

    const mcpNames = parseMcpServerNames(files[MCP_PATH] ?? null);
    const { changed } = seedRegistry(parsed, mcpNames);
    if (changed) {
      result[CONFIG_PATH] = JSON.stringify(parsed, null, 2) + "\n";
    }

    return result;
  },
};
