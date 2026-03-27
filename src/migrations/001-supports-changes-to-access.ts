import type { Migration } from "./types.js";

export const migration: Migration = {
  version: 1,
  name: "Migrate supportsChanges to access",
  priority: "blocking",
  files: ["data/config.json"],
  static: (files) => {
    const result: Record<string, string> = {};
    for (const [path, content] of Object.entries(files)) {
      if (!path.endsWith("config.json") || !content) continue;
      const config = JSON.parse(content);
      let changed = false;
      for (const repo of config.repositories ?? []) {
        if ("supportsChanges" in repo) {
          if (repo.supportsChanges) {
            repo.access = { read: "member", write: "dev" };
          } else {
            repo.access = { read: "member" };
          }
          delete repo.supportsChanges;
          changed = true;
        }
      }
      if (changed) {
        result[path] = JSON.stringify(config, null, 2) + "\n";
      }
    }
    return result;
  },
};
