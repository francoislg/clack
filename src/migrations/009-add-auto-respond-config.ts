import type { Migration } from "./types.js";

export const migration: Migration = {
  version: 9,
  name: "Add autoRespond config field",
  priority: "blocking",
  prompt: `Add the autoRespond configuration field to data/config.json.

1. Read data/config.json
2. If the "autoRespond" field already exists at the top level, do nothing — the config is already migrated.
3. If "autoRespond" does NOT exist, add it with: "autoRespond": { "enabled": false }
   - Place it after "mentions" if present, otherwise after "directMessages".
4. Preserve JSON formatting (2-space indent).
5. Do NOT change any other fields.

Default to disabled because this feature requires adding message.channels and message.groups to the Slack app manifest's event subscriptions before it can work.`,
  files: ["data/config.json"],
};
