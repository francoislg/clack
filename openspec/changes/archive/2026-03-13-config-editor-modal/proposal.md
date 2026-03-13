## Why

The configuration section on the Home Tab currently shows a static list of files with no way to interact with them. Admins must use the chat interface (`propose_config_update`) to view or edit configuration files, which is indirect for simple edits. A previous modal-based editor was removed because it didn't work well with the old flat-file structure. Now that the cascading directory system is in place, a redesigned modal editor with proper file browsing, creation, and deletion makes configuration management much more accessible.

## What Changes

- **Replace static file listing with interactive directory view**: Each role directory (`user/`, `dev/`, `admin/`) and repo directory shows a file count and a [View] button on the Home Tab.
- **File picker modal**: Clicking [View] opens a modal listing all files in that directory as buttons, with source status labels (Custom, Customized). Includes a [+ Create New File] button. Files over 3000 characters show "Use chat" instead of [Edit] since Slack's text input has a 3000-char limit.
- **File editor modal** (stacked): Clicking a file button pushes an editor modal with the file content in a textarea. Submit button label reflects the action: "Create Override" for default files, "Save" for files with existing overrides or custom-only files.
- **Delete/reset capability**: The editor modal includes a "Reset to Default" button (for files with overrides) or "Delete File" (for custom-only files). Deleting updates the modal in-place to show the default content.
- **Create new file modal** (stacked): Clicking [+ Create New File] pushes a modal with filename input and content textarea. The `.md` extension is added automatically.
- **Repo files use the same flow**: Repository instruction directories (`{repo}/`) appear alongside role directories with the same [View] → file picker → editor experience. No [+ Create New File] for repo directories since filenames are convention-based.

## Capabilities

### New Capabilities

_None — this extends existing capabilities._

### Modified Capabilities

- `home-tab`: Replaces static Configuration section with interactive directory view and [View] buttons. Removes "No Configuration Edit Modal" and "No edit buttons" requirements.
- `admin-edit-instructions`: Reintroduces modal-based editing redesigned for the cascading directory structure. Adds file picker, create new file, and delete/reset flows.

## Impact

- `src/slack/homeTab.ts` — Rebuild `buildConfigurationSection()` for interactive layout, add modal builder functions
- `src/slack/handlers/homeTab.ts` — Register action handlers for [View] buttons, file edit buttons, create/delete actions, and view submission handlers
- `src/configurationFiles.ts` — May need a `deleteInstructionFile()` function
- `src/slack/homeTab.test.ts` — Update configuration section tests
- `src/slack/handlers/homeTab.test.ts` — Add tests for new modal interaction handlers
