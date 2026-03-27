import type { Migration } from "./types.js";

export const migration: Migration = {
  version: 11,
  name: "Add allowScheduledMessages config field",
  priority: "enhancement",
  prompt: `Add the allowScheduledMessages configuration field to data/config.json.

1. Read data/config.json
2. If the "allowScheduledMessages" field already exists at the top level, do nothing — the config is already migrated.
3. If "allowScheduledMessages" does NOT exist, add it with: "allowScheduledMessages": false
   - Place it after "changesWorkflow" if present, otherwise after "claudeCode".
4. Preserve JSON formatting (2-space indent).
5. Do NOT change any other fields.

Default to false because this is an opt-in feature. Users enable it when they want Claude to schedule messages via chat.scheduleMessage.`,
  files: ["data/config.json"],
};
