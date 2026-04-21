import type { Migration, StaticFileResult } from "./types.js";

export const migration: Migration = {
  version: 15,
  name: "Add stop reaction config field",
  priority: "blocking",
  files: ["data/config.json"],
  static: (files) => {
    const result: Record<string, StaticFileResult> = {};
    for (const [path, content] of Object.entries(files)) {
      if (!path.endsWith("config.json") || !content) continue;
      const config = JSON.parse(content);
      if (!config || typeof config !== "object") continue;
      const reactions = config.reactions;
      if (!reactions || typeof reactions !== "object") continue;
      if ("stop" in reactions) continue;
      reactions.stop = "octagonal_sign";
      result[path] = JSON.stringify(config, null, 2) + "\n";
    }
    return result;
  },
};
