## Why

The `admin_read_file` and `admin_write_file` tools currently include `auth/.env` in their allowlist. This exposes API tokens (LINEAR_API_TOKEN, SENTRY_ACCESS_TOKEN, etc.) to Claude's conversation context — a security issue even for admin-only access. Environment variables should be manageable without ever revealing existing values.

## What Changes

- **BREAKING**: Remove `auth/.env` from the `admin_read_file` and `admin_write_file` allowlist
- Add `admin_set_env` tool: set or delete a single environment variable by key. Passing an empty/omitted value deletes the key. Claude never sees existing values.
- Add `admin_list_env` tool: returns key names only (no values) from `auth/.env`, so Claude can check what's configured without seeing secrets.
- Update tool mappings for the new tools

## Capabilities

### New Capabilities
- `admin-env-tools`: Secure environment variable management tools (set/delete by key, list keys only) that never expose secret values

### Modified Capabilities
- `admin-config-tools`: Remove `auth/.env` from the file path allowlist
- `clack-tools`: Add `admin_set_env` and `admin_list_env` to admin role tool registration

## Impact

- **Modified files**: `src/tools/admin/allowlist.ts` (remove auth/.env), `src/tools/server.ts` (register new tools), `data/default_configuration/tool_mapping/clack.json` (add labels)
- **New files**: `src/tools/admin/adminSetEnv.ts`, `src/tools/admin/adminListEnv.ts`
- **No new dependencies**
- **Breaking**: Admins can no longer read/write `auth/.env` via `admin_read_file`/`admin_write_file`
