import type { Migration } from "./types.js";

export const migration: Migration = {
  version: 12,
  name: "Add threadAutoRespondMaxAgeMinutes config field",
  priority: "enhancement",
  files: ["data/config.json"],
  static: (files) => {
    const result: Record<string, string> = {};
    for (const [path, content] of Object.entries(files)) {
      if (!path.endsWith("config.json") || !content) continue;
      const config = JSON.parse(content);
      if ("threadAutoRespondMaxAgeMinutes" in config) continue;
      config.threadAutoRespondMaxAgeMinutes = 60;
      result[path] = JSON.stringify(config, null, 2) + "\n";
    }
    return result;
  },
};
