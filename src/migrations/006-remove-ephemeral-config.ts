import type { Migration } from "./types.js";

export const migration: Migration = {
  version: 6,
  name: "Remove ephemeral config and migrate user preferences",
  priority: "blocking",
  files: ["data/config.json", "data/state/user-preferences.json"],
  static: (files) => {
    const result: Record<string, string> = {};

    for (const [path, content] of Object.entries(files)) {
      if (path.endsWith("config.json") && content) {
        const config = JSON.parse(content);
        let changed = false;
        if (config.reactions && "responseType" in config.reactions) {
          delete config.reactions.responseType;
          changed = true;
        }
        if (config.slack && "notifyHiddenThread" in config.slack) {
          delete config.slack.notifyHiddenThread;
          changed = true;
        }
        if (changed) {
          result[path] = JSON.stringify(config, null, 2) + "\n";
        }
      }

      if (path.endsWith("user-preferences.json") && content) {
        const prefs = JSON.parse(content);
        let changed = false;
        for (const userId of Object.keys(prefs)) {
          const user = prefs[userId];
          if (typeof user !== "object" || user === null) continue;
          if (user.dmOptOut === true) {
            user.reactionDelivery = "thread";
          } else {
            user.reactionDelivery = "dm";
          }
          if ("dmOptOut" in user) {
            delete user.dmOptOut;
          }
          changed = true;
        }
        if (changed) {
          result[path] = JSON.stringify(prefs, null, 2) + "\n";
        }
      }
    }

    return result;
  },
};
