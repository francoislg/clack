import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { MigrationState } from "./types.js";

function getVersionPath(): string {
  return resolve(process.cwd(), "data", "state", "version.json");
}

export async function readVersion(): Promise<number> {
  const path = getVersionPath();

  if (!existsSync(path)) {
    return 0;
  }

  const content = await readFile(path, "utf-8");
  const state: MigrationState = JSON.parse(content);
  return state.version;
}

export async function writeVersion(version: number): Promise<void> {
  const path = getVersionPath();
  const dir = dirname(path);

  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  const state: MigrationState = { version };
  await writeFile(path, JSON.stringify(state, null, 2) + "\n");
}
