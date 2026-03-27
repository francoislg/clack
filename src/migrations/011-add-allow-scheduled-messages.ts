import type { Migration } from "./types.js";

export const migration: Migration = {
  version: 11,
  name: "Add allowScheduledMessages config field",
  priority: "enhancement",
  files: ["data/config.json"],
  static: (files) => {
    const result: Record<string, string> = {};
    for (const [path, content] of Object.entries(files)) {
      if (!path.endsWith("config.json") || !content) continue;
      const config = JSON.parse(content);
      if ("allowScheduledMessages" in config) continue;
      config.allowScheduledMessages = false;
      result[path] = JSON.stringify(config, null, 2) + "\n";
    }
    return result;
  },
};
