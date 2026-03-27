import type { Migration } from "./types.js";

export const migration: Migration = {
  version: 9,
  name: "Add autoRespond config field",
  priority: "blocking",
  files: ["data/config.json"],
  static: (files) => {
    const result: Record<string, string> = {};
    for (const [path, content] of Object.entries(files)) {
      if (!path.endsWith("config.json") || !content) continue;
      const config = JSON.parse(content);
      if ("autoRespond" in config) continue;
      config.autoRespond = { enabled: false };
      result[path] = JSON.stringify(config, null, 2) + "\n";
    }
    return result;
  },
};
