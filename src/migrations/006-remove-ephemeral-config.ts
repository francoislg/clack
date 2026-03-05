import type { Migration } from "./types.js";

export const migration: Migration = {
  version: 6,
  name: "Remove ephemeral config and migrate user preferences",
  priority: "blocking",
  prompt: `Migrate config and user preferences after removing the ephemeral response system.

1. In data/config.json:
   - Remove the "responseType" property from the "reactions" object if it exists
   - Remove the "notifyHiddenThread" property from the "slack" object if it exists
   - Do NOT change any other fields

2. In data/state/user-preferences.json (if it exists):
   - For each user entry, if it has "dmOptOut": true, set "reactionDelivery": "thread"
   - For each user entry, if it has "dmOptOut": false or no "dmOptOut" field, set "reactionDelivery": "dm"
   - Remove the "dmOptOut" property from each user entry
   - Do NOT change any other fields

If data/state/user-preferences.json does not exist, skip step 2.
Preserve JSON formatting (2-space indent).`,
  files: ["data/config.json", "data/state/user-preferences.json"],
};
