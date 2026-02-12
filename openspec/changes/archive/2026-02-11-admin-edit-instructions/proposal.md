## Why

Admins currently have no way to customize Clack's behavior from Slack — changing the system prompt instructions requires SSH/file access to the server and editing the file manually. Admins should be able to view and edit the instructions directly from the Home Tab, with changes taking effect on the next query.

## What Changes

- Add a "Configuration" section to the Home Tab for admins (owner + admins) listing instruction files in `data/configuration/`
- If no overrides exist yet, show the default files from `data/default_configuration/` as read-only with an option to create an editable copy
- Clicking "Edit" on a file opens a Slack modal pre-filled with its current content
- On submit, the file is written to `data/configuration/` (creating the override)
- Changes take effect immediately on the next Clack invocation (instructions are read fresh each time)
- Only files inside `data/configuration/` are writable — the system refuses to write anywhere else

**Depends on:** `role-based-instructions` change (introduces the `configuration/` and `default_configuration/` directories, convention-based instruction files)

## Capabilities

### New Capabilities
- `admin-edit-instructions`: Admin UI for viewing and editing instruction files via the Slack Home Tab. Shows files from `data/configuration/` (editable) and `data/default_configuration/` (read-only defaults).

### Modified Capabilities
- `home-tab`: Add configuration section to the admin area of the Home Tab

## Impact

- **Code**: New handler for the edit modal action/submission, new Home Tab blocks for the configuration section, `configurationFiles.ts` module for file operations
- **Files at runtime**: Files in `data/configuration/` are written to on edit
- **Security**: Only admins (owner + admins) can view/edit; role check enforced on both button visibility and modal submission. Writes are restricted to `data/configuration/` — no path traversal or writing outside that directory
