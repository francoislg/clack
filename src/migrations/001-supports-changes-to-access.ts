import type { Migration } from "./types.js";

export const migration: Migration = {
  version: 1,
  name: "Migrate supportsChanges to access",
  priority: "blocking",
  prompt: `Migrate the repository config from the deprecated "supportsChanges" boolean to the new "access" property.

For each repository in the "repositories" array of data/config.json:
- If the repository has "supportsChanges": true, replace it with "access": { "read": "member", "write": "dev" }
- If the repository has "supportsChanges": false, replace it with "access": { "read": "member" }
- If the repository has no "supportsChanges" field at all, leave it unchanged (it already uses the new format or defaults)
- Remove the "supportsChanges" key entirely after migrating

Do NOT change any other fields. Preserve formatting and all other config properties.
If no repositories have "supportsChanges", the file is already migrated — do nothing.`,
  files: ["data/config.json"],
};
