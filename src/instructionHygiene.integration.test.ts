import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { z } from "zod";

// Integration guard: enforces the instruction/context-file hygiene invariants over
// the REAL on-disk instruction trees, so the always-on prompt surface can't silently
// rot back into dead files, orphaned topics, or dead `attach_integration` references.
//
// `data/default_configuration/` is git-tracked and always present (checked in CI).
// `data/config.json` and `data/configuration/` are gitignored — present locally and
// at the pre-commit `npm test` gate, absent in a fresh CI checkout. Checks that need
// them are conditioned on their existence so the guard is meaningful locally and never
// flaky in CI.

const projectRoot = resolve(import.meta.dirname, "..");
const DEFAULT_DIR = resolve(projectRoot, "data/default_configuration");
const CUSTOM_DIR = resolve(projectRoot, "data/configuration");
const CONFIG_JSON = resolve(projectRoot, "data/config.json");

const McpRegistrySchema = z.object({
  mcpServers: z.record(z.string(), z.unknown()).default({}),
});

/** Recursively collect absolute paths of non-hidden `.md` files under `dir`. */
function listMarkdown(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listMarkdown(full));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

/** Absolute paths of every topic directory (a child of a `topics/` folder) under `root`. */
function listTopicDirPaths(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = join(dir, entry.name);
      if (entry.name === "topics") {
        for (const topic of readdirSync(full, { withFileTypes: true })) {
          if (topic.isDirectory()) out.push(join(full, topic.name));
        }
      }
      walk(full);
    }
  };
  walk(root);
  return out;
}

/** Topic folder NAMES (leaf directory names) under `root`. */
function listTopicNames(root: string): string[] {
  return listTopicDirPaths(root).map((p) => p.split("/").pop() ?? "");
}

const rel = (p: string) => relative(projectRoot, p);

describe("instruction-file hygiene", () => {
  it("has no empty or whitespace-only instruction files", () => {
    const offenders = [...listMarkdown(DEFAULT_DIR), ...listMarkdown(CUSTOM_DIR)]
      .filter((f) => readFileSync(f, "utf-8").trim().length === 0)
      .map(rel);
    expect(
      offenders,
      `Empty instruction files are silently suppressed by the resolver — remove them:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("has no stray .md files at the configuration root (they are never scanned)", () => {
    const strayAtRoot = (dir: string) =>
      existsSync(dir)
        ? readdirSync(dir, { withFileTypes: true })
            .filter((e) => e.isFile() && e.name.endsWith(".md") && !e.name.startsWith("."))
            .map((e) => rel(join(dir, e.name)))
        : [];
    const offenders = [...strayAtRoot(DEFAULT_DIR), ...strayAtRoot(CUSTOM_DIR)];
    expect(
      offenders,
      `.md files directly under a configuration root are never loaded (scanMdFiles only reads role dirs):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("has no empty topic directories", () => {
    const offenders = [...listTopicDirPaths(DEFAULT_DIR), ...listTopicDirPaths(CUSTOM_DIR)]
      .filter((d) => listMarkdown(d).length === 0)
      .map(rel);
    expect(
      offenders,
      `Topic directories with no .md files are orphans — remove them:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("every attach_integration reference resolves to a registered server or topic", () => {
    // Needs the MCP registry (config.json) to be authoritative. Skip when absent
    // (fresh CI checkout) — the local pre-commit gate has it and is the enforcement point.
    if (!existsSync(CONFIG_JSON)) {
      expect(existsSync(CONFIG_JSON)).toBe(false); // documents the intentional skip
      return;
    }

    const registry = McpRegistrySchema.parse(JSON.parse(readFileSync(CONFIG_JSON, "utf-8")));
    const serverKeys = Object.keys(registry.mcpServers);
    const topicNames = [...listTopicNames(DEFAULT_DIR), ...listTopicNames(CUSTOM_DIR)];
    const valid = new Set<string>([...serverKeys, ...topicNames]);

    const dead: string[] = [];
    for (const file of [...listMarkdown(DEFAULT_DIR), ...listMarkdown(CUSTOM_DIR)]) {
      const content = readFileSync(file, "utf-8");
      for (const match of content.matchAll(/attach_integration\("([^"]+)"\)/g)) {
        const name = match[1];
        if (name.includes("<")) continue; // literal <name> placeholder in prose examples
        const base = name.split(":")[0]; // "plugin:server" on-demand form → validate the plugin prefix
        if (!valid.has(name) && !valid.has(base)) {
          dead.push(`${rel(file)} → attach_integration("${name}")`);
        }
      }
    }
    expect(
      dead,
      `Dead attach_integration references (no registered mcpServer key and no topic dir):\n${dead.join("\n")}`,
    ).toEqual([]);
  });
});
