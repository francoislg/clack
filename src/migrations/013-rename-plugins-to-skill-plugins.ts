import { existsSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import type { Migration } from "./types.js";
import { getDataDir } from "../config.js";

export const migration: Migration = {
  version: 13,
  name: "Rename data/plugins to data/skill-plugins",
  priority: "blocking",
  // No files needed — the rename is a directory operation
  files: [],
  static: () => {
    const dataDir = getDataDir();
    const oldPath = resolve(dataDir, "plugins");
    const newPath = resolve(dataDir, "skill-plugins");

    if (existsSync(oldPath) && !existsSync(newPath)) {
      renameSync(oldPath, newPath);
    }

    // No file changes to return
    return {};
  },
};
